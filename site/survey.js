import { proposedSchedule } from "./proposed-schedule.js";
import { currentSchedule } from "./schedule.js";
import { submitToAppsScript } from "./submit-response.js";

(() => {
  "use strict";

  const config = window.SURVEY_CONFIG || {};
  const weeklySchedule = currentSchedule;
  const attendanceStatuses = [
    { value: "regular", label: "Regularly attend", shortLabel: "Regular" },
    { value: "sometimes", label: "Sometimes attend", shortLabel: "Sometimes" },
    { value: "rarely", label: "Rarely attend", shortLabel: "Rarely" },
    { value: "never", label: "Never or cannot attend", shortLabel: "Never / can’t" }
  ];
  const form = document.querySelector("#surveyForm");
  const steps = [...document.querySelectorAll(".form-step")];
  const currentStep = document.querySelector("#currentStep");
  const progressLabel = document.querySelector("#progressLabel");
  const progressBar = document.querySelector("#progressBar");
  const progressTrack = document.querySelector(".progress-track");
  const errorBox = document.querySelector("#formError");
  const attendanceSurveys = [
    {
      key: "current",
      inputName: "classAttendance",
      schedule: weeklySchedule,
      root: document.querySelector("#weekCalendar"),
      block: document.querySelector("#weeklyAttendanceBlock"),
      count: document.querySelector("#calendarCount"),
      regularCount: document.querySelector("#currentRegularCount")
    },
    {
      key: "proposed",
      inputName: "proposedAttendance",
      schedule: proposedSchedule,
      root: document.querySelector("#proposedCalendar"),
      block: document.querySelector("#proposedAttendanceBlock"),
      count: document.querySelector("#proposedCalendarCount"),
      regularCount: document.querySelector("#proposedRegularCount")
    }
  ];
  attendanceSurveys.forEach((survey) => {
    survey.flatSchedule = survey.schedule.flatMap((day) =>
      day.classes.map((classItem) => ({ ...classItem, day: day.day }))
    );
    renderWeekCalendar(survey);
    survey.inputs = [...survey.root.querySelectorAll("input[data-class-attendance]")];
    renderWeekdayTimeControls(survey);
    updateCalendarProgress(survey);
  });
  const comments = document.querySelector("#comments");
  const commentCount = document.querySelector("#commentCount");
  const email = document.querySelector("#email");
  const memberName = document.querySelector("#memberName");
  const consentRow = document.querySelector("#consentRow");
  const connectionBanner = document.querySelector("#connectionBanner");
  const submitButton = document.querySelector("#submitButton");
  const successState = document.querySelector("#successState");
  const resetButton = document.querySelector("#resetSurvey");
  const labels = ["Current schedule", "Proposed schedule", "Final details"];
  const storage = config.storage || "apps-script";
  const endpointReady = Boolean(config.endpoint) && !config.endpoint.includes("REPLACE");
  const turnstileReady =
    Boolean(config.turnstileSiteKey) && !config.turnstileSiteKey.includes("REPLACE");
  const submissionReady = endpointReady && (storage === "apps-script" || (storage === "worker" && turnstileReady));

  let activeStep = 0;
  let responseId = createUuid();
  let turnstileToken = "";
  let turnstileWidgetId = null;

  document.querySelectorAll("[data-gym-name]").forEach((element) => {
    if (config.gymName) element.textContent = config.gymName;
  });

  if (!submissionReady) {
    connectionBanner.hidden = false;
    if (storage === "worker" && endpointReady && !turnstileReady) {
      connectionBanner.querySelector("span").textContent =
        "Submissions are disabled until bot protection is connected.";
    }
  } else if (storage === "worker") {
    loadTurnstile();
  }

  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!validateStep(activeStep)) return;
      showStep(activeStep + 1);
    });
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showStep(activeStep - 1));
  });

  attendanceSurveys.forEach((survey) => {
    survey.inputs.forEach((input) => {
      input.addEventListener("change", () => {
        updateClassCard(input);
        updateCalendarProgress(survey);
        updateWeekdayTimeControls(survey);
        survey.block.classList.remove("is-invalid");
        hideError();
      });
    });

    survey.root.querySelectorAll("[data-mark-day-never]").forEach((button) => {
      button.addEventListener("click", () => {
        const day = button.dataset.markDayNever;
        survey.inputs
          .filter((input) => input.dataset.day === day && input.value === "never")
          .forEach((input) => {
            input.checked = true;
            updateClassCard(input);
          });
        updateCalendarProgress(survey);
        updateWeekdayTimeControls(survey);
        survey.block.classList.remove("is-invalid");
        hideError();
      });
    });
  });

  comments.addEventListener("input", () => {
    commentCount.textContent = String(comments.value.length);
  });

  memberName.addEventListener("input", () => {
    memberName.removeAttribute("aria-invalid");
    memberName.closest(".question-block").classList.remove("is-invalid");
    hideError();
  });

  email.addEventListener("input", () => {
    const hasEmail = Boolean(email.value.trim());
    consentRow.hidden = !hasEmail;
    if (!hasEmail) form.elements.contactConsent.checked = false;
  });

  form.querySelectorAll('input[name="barriers"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const noneInput = form.querySelector('input[name="barriers"][value="none"]');
      if (input.value === "none") {
        form.querySelectorAll('input[name="barriers"]:not([value="none"])').forEach((item) => {
          item.checked = false;
        });
      } else {
        noneInput.checked = false;
      }
    });
  });

  form.addEventListener("input", (event) => {
    const block = event.target.closest(".question-block");
    if (block) block.classList.remove("is-invalid");
    hideError();
  });

  form.addEventListener("submit", handleSubmit);

  resetButton.addEventListener("click", () => {
    form.reset();
    responseId = createUuid();
    comments.dispatchEvent(new Event("input"));
    email.dispatchEvent(new Event("input"));
    attendanceSurveys.forEach((survey) => {
      updateCalendarProgress(survey);
      survey.block.classList.remove("is-invalid");
      survey.root.querySelectorAll(".class-slot").forEach((slot) => {
        slot.dataset.status = "never";
      });
      updateWeekdayTimeControls(survey);
    });
    document.querySelector(".progress-wrap").hidden = false;
    successState.hidden = true;
    form.hidden = false;
    showStep(0, false);
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
  });

  function showStep(index, scroll = true) {
    if (index < 0 || index >= steps.length) return;
    activeStep = index;
    steps.forEach((step, stepIndex) => {
      const isActive = stepIndex === index;
      step.hidden = !isActive;
      step.classList.toggle("is-active", isActive);
    });
    currentStep.textContent = String(index + 1);
    progressLabel.textContent = labels[index];
    progressBar.style.width = `${((index + 1) / steps.length) * 100}%`;
    progressTrack.setAttribute("aria-valuenow", String(index + 1));
    hideError();
    if (scroll) {
      document.querySelector("#survey").scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    }
  }

  function validateStep(index) {
    hideError();
    steps[index].querySelectorAll(".is-invalid").forEach((item) => {
      item.classList.remove("is-invalid");
    });

    if (index === 0) {
      const name = memberName.value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
      const valid = Boolean(name) && name.length <= 120;
      memberName.setAttribute("aria-invalid", String(!valid));
      if (!valid) {
        memberName.closest(".question-block").classList.add("is-invalid");
        showError("Please enter your name (up to 120 characters) so we can attach your answers to you.");
        memberName.focus();
        return false;
      }
    }

    const survey = attendanceSurveys[index];
    if (survey) {
      // Keep an unanswered class equivalent to the visible Never / can’t default.
      survey.flatSchedule.forEach((classItem) => {
        const selected = survey.root.querySelector(
          `input[name="${survey.inputName}_${classItem.id}"]:checked`
        );
        if (!selected) {
          const defaultInput = survey.root.querySelector(
            `input[name="${survey.inputName}_${classItem.id}"][value="never"]`
          );
          defaultInput.checked = true;
          updateClassCard(defaultInput);
        }
      });
      updateCalendarProgress(survey);
      updateWeekdayTimeControls(survey);
    }

    if (index === 2) {
      const emailValue = email.value.trim();
      if (emailValue && !email.checkValidity()) {
        email.closest(".question-block").classList.add("is-invalid");
        showError("Enter a valid email address, or leave the field blank.");
        email.focus();
        return false;
      }
      if (emailValue && !form.elements.contactConsent.checked) {
        email.closest(".question-block").classList.add("is-invalid");
        showError("Please confirm that we may contact you, or remove your email address.");
        form.elements.contactConsent.focus();
        return false;
      }
    }

    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    for (let index = 0; index < steps.length; index += 1) {
      if (!validateStep(index)) {
        if (activeStep !== index) {
          showStep(index);
          validateStep(index);
        }
        return;
      }
    }

    if (!submissionReady) {
      showError(
        "This preview is not connected yet. Response storage must be configured before collecting responses."
      );
      return;
    }

    if (storage === "worker" && !turnstileToken) {
      showError("Complete the verification check, then submit again.");
      return;
    }

    const data = new FormData(form);
    const payload = {
      surveyVersion: "2026-10-18",
      responseId,
      submittedAt: new Date().toISOString(),
      memberName: memberName.value.replace(/[\u0000-\u001F\u007F]/g, "").trim(),
      classAttendance: collectAttendance(attendanceSurveys[0], data),
      proposedAttendance: collectAttendance(attendanceSurveys[1], data),
      barriers: data.getAll("barriers"),
      comments: String(data.get("comments") || "").trim(),
      email: String(data.get("email") || "").trim().toLowerCase(),
      contactConsent: data.get("contactConsent") === "yes",
      website: String(data.get("website") || ""),
      turnstileToken
    };

    setSubmitting(true);
    hideError();

    try {
      if (storage === "apps-script") {
        await submitToAppsScript(config.endpoint, payload);
      } else {
        const response = await fetch(config.endpoint, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          referrerPolicy: "strict-origin-when-cross-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok !== true) {
          throw new Error(result.message || "We couldn’t save your response. Please try again.");
        }
      }

      form.hidden = true;
      document.querySelector(".progress-wrap").hidden = true;
      successState.hidden = false;
      successState.focus();
    } catch (error) {
      showError(error.message || "We couldn’t save your response. Please try again.");
      if (turnstileWidgetId !== null && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId);
        turnstileToken = "";
      }
    } finally {
      setSubmitting(false);
    }
  }

  function setSubmitting(isSubmitting) {
    submitButton.disabled = isSubmitting;
    submitButton.querySelector(".submit-label").hidden = isSubmitting;
    submitButton.querySelector(".submit-loading").hidden = !isSubmitting;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.focus({ preventScroll: true });
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function loadTurnstile() {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      turnstileWidgetId = window.turnstile.render("#turnstileMount", {
        sitekey: config.turnstileSiteKey,
        action: "class-time-survey",
        theme: "light",
        size: "flexible",
        callback(token) {
          turnstileToken = token;
          hideError();
        },
        "expired-callback"() {
          turnstileToken = "";
        },
        "error-callback"() {
          turnstileToken = "";
          showError("The verification check could not load. Refresh the page and try again.");
        }
      });
    };
    script.onerror = () => {
      showError("The verification check could not load. Refresh the page and try again.");
    };
    document.head.appendChild(script);
  }

  function renderWeekCalendar(survey) {
    const workWeekCalendar = survey.root.querySelector(".work-week-calendar");
    const weekendCalendar = survey.root.querySelector(".weekend-calendar");
    workWeekCalendar.replaceChildren();
    weekendCalendar.replaceChildren();

    survey.schedule.forEach((day) => {
      const column = document.createElement("section");
      column.className = "calendar-day";
      column.setAttribute("aria-labelledby", `${survey.key}-day-${day.shortDay.toLowerCase()}`);

      const heading = document.createElement("header");
      heading.className = "calendar-day-heading";

      const title = document.createElement("h6");
      title.id = `${survey.key}-day-${day.shortDay.toLowerCase()}`;
      title.textContent = day.day;

      const total = document.createElement("span");
      total.textContent = `${day.classes.length} ${day.classes.length === 1 ? "class" : "classes"}`;

      const unavailableButton = document.createElement("button");
      unavailableButton.type = "button";
      unavailableButton.dataset.markDayNever = day.day;
      unavailableButton.textContent = "Can’t attend this day";
      unavailableButton.setAttribute(
        "aria-label",
        `Mark every ${day.day} class as never or cannot attend`
      );

      heading.append(title, total, unavailableButton);
      column.append(heading);

      day.classes.forEach((classItem) => {
        const slot = document.createElement("fieldset");
        slot.className = "class-slot";
        slot.dataset.classId = classItem.id;
        slot.dataset.status = "never";

        const legend = document.createElement("legend");
        const time = document.createElement("strong");
        time.textContent = classItem.time;
        const program = document.createElement("small");
        program.textContent = classItem.program;
        legend.append(time, program);

        const choices = document.createElement("div");
        choices.className = "class-status-options";

        attendanceStatuses.forEach((status) => {
          const label = document.createElement("label");
          label.dataset.status = status.value;
          const attendanceLabel = survey.key === "proposed"
            ? (status.value === "never" ? "Would never attend / cannot attend" : `Would ${status.label.toLowerCase()}`)
            : status.label;
          label.title = attendanceLabel;

          const input = document.createElement("input");
          input.type = "radio";
          input.name = `${survey.inputName}_${classItem.id}`;
          input.value = status.value;
          input.defaultChecked = status.value === "never";
          input.id = `${survey.key}-${classItem.id}-${status.value}`;
          input.dataset.classAttendance = "true";
          input.dataset.day = day.day;
          input.dataset.time = classItem.time;
          input.setAttribute("aria-label", `${survey.key === "proposed" ? "Proposed" : "Current"} schedule, ${day.day} ${classItem.time}: ${attendanceLabel}`);

          const text = document.createElement("span");
          text.textContent = status.shortLabel;

          label.append(input, text);
          choices.append(label);
        });

        slot.append(legend, choices);
        column.append(slot);
      });

      const calendar = ["Saturday", "Sunday"].includes(day.day)
        ? weekendCalendar
        : workWeekCalendar;
      calendar.append(column);
    });
  }

  function updateClassCard(input) {
    const slot = input.closest(".class-slot");
    if (slot) slot.dataset.status = input.value;
  }

  function renderWeekdayTimeControls(survey) {
    const container = survey.root.querySelector("[data-weekday-time-controls]");
    const weekdayClasses = survey.flatSchedule.filter(
      (classItem) => !["Saturday", "Sunday"].includes(classItem.day)
    );
    const times = [...new Set(weekdayClasses.map((classItem) => classItem.time))];
    times.sort((a, b) => minutesAfterMidnight(a) - minutesAfterMidnight(b));
    survey.timeControls = [];

    times.forEach((time) => {
      const classes = weekdayClasses.filter((classItem) => classItem.time === time);
      const label = document.createElement("label");
      label.className = "weekday-time-control";
      const caption = document.createElement("span");
      const timeLabel = document.createElement("strong");
      timeLabel.textContent = time;
      const daysLabel = document.createElement("small");
      daysLabel.textContent = classes.map((classItem) => classItem.day.slice(0, 3)).join(", ");
      caption.append(timeLabel, daysLabel);

      const select = document.createElement("select");
      select.dataset.weekdayTime = time;
      select.setAttribute("aria-label", `${survey.key === "proposed" ? "Proposed" : "Current"} schedule: all weekday classes at ${time}`);
      const mixedOption = new Option("Mixed — varies by day", "mixed");
      mixedOption.disabled = true;
      select.add(mixedOption);
      attendanceStatuses.forEach((status) => {
        select.add(new Option(status.shortLabel, status.value, status.value === "never", status.value === "never"));
      });

      const inputs = survey.inputs.filter(
        (input) => input.dataset.time === time && !["Saturday", "Sunday"].includes(input.dataset.day)
      );
      select.addEventListener("change", () => {
        inputs.filter((input) => input.value === select.value).forEach((input) => {
          input.checked = true;
          updateClassCard(input);
        });
        updateCalendarProgress(survey);
        updateWeekdayTimeControls(survey);
        hideError();
      });

      label.append(caption, select);
      container.append(label);
      survey.timeControls.push({ select, inputs });
    });
    updateWeekdayTimeControls(survey);
  }

  function updateWeekdayTimeControls(survey) {
    survey.timeControls.forEach(({ select, inputs }) => {
      const statuses = new Set(inputs.filter((input) => input.checked).map((input) => input.value));
      select.value = statuses.size === 1 ? [...statuses][0] : "mixed";
    });
  }

  function minutesAfterMidnight(time) {
    const [clock, period] = time.split(" ");
    const [hours, minutes] = clock.split(":").map(Number);
    return (hours % 12) * 60 + minutes + (period === "PM" ? 720 : 0);
  }

  function updateCalendarProgress(survey) {
    const attending = survey.inputs.filter((input) => input.checked && input.value !== "never").length;
    const regular = survey.inputs.filter((input) => input.checked && input.value === "regular").length;
    survey.count.textContent = `${attending} of ${survey.flatSchedule.length} attending`;
    survey.count.classList.toggle("has-attendance", attending > 0);
    survey.regularCount.textContent = `${regular} ${regular === 1 ? "class" : "classes"}`;
  }

  function collectAttendance(survey, data) {
    return survey.flatSchedule.map((classItem) => ({
      classId: classItem.id,
      day: classItem.day,
      time: classItem.time,
      program: classItem.program,
      status: data.get(`${survey.inputName}_${classItem.id}`) || "never"
    }));
  }

  function createUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
})();
