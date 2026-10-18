// Apps Script sends a receipt only after it saves the response. A regular form POST
// avoids CORS preflight, while postMessage provides a verifiable acknowledgement.
export function submitToAppsScript(endpoint, payload, { timeoutMs = 45000 } = {}) {
  const url = new URL(endpoint);
  if (url.origin !== "https://script.google.com" || url.username || url.password ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) {
    return Promise.reject(new Error("The survey endpoint is not a deployed Google Apps Script /exec URL."));
  }

  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.name = `cfb-receipt-${nonce}`;
    iframe.hidden = true;
    iframe.title = "Survey submission receipt";
    const postForm = document.createElement("form");
    postForm.method = "POST";
    postForm.action = url.href;
    postForm.target = iframe.name;
    postForm.hidden = true;
    for (const [name, value] of Object.entries({
      payload: JSON.stringify(payload), responseId: payload.responseId,
      receiptNonce: nonce, returnOrigin: window.location.origin
    })) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      postForm.append(input);
    }

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", receiveReceipt);
      iframe.remove();
      postForm.remove();
    };
    const receiveReceipt = (event) => {
      const receipt = event.data;
      // Google wraps HtmlService in nested frames, so event.source need not be
      // iframe.contentWindow. The Google origin AND unguessable per-attempt nonce
      // bind the receipt to this request, including when a timed-out request retries.
      if (!isAppsScriptOrigin(event.origin) || !receipt ||
          receipt.channel !== "cfb-survey-receipt" || receipt.nonce !== nonce ||
          receipt.responseId !== payload.responseId || typeof receipt.ok !== "boolean") return;
      cleanup();
      if (receipt.ok) resolve(receipt);
      else reject(new Error(receipt.message || "We couldn’t save your response. Please try again."));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("We couldn’t confirm that your response was saved. Please try again; retrying won’t create a duplicate."));
    }, timeoutMs);
    window.addEventListener("message", receiveReceipt);
    document.body.append(iframe, postForm);
    try { postForm.submit(); }
    catch (error) { cleanup(); reject(error); }
  });
}

function isAppsScriptOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !url.port && (url.hostname === "script.google.com" ||
      url.hostname === "script.googleusercontent.com" ||
      url.hostname.endsWith("-script.googleusercontent.com") ||
      url.hostname.endsWith(".script.googleusercontent.com"));
  } catch { return false; }
}
