// Source: Schedule.xlsx, "Daily schedule", supplied October 18, 2026.
// Monday–Thursday: column B times and columns C–F class labels.
// Friday: column H labels; B times except G19:G21 for the afternoon.
// Saturday: I times / J labels. Sunday: K times / L labels.
// Only cells labeled CrossFit are included. Template dates are not effective dates.
export const proposedSchedule = [
  {
    day: "Monday",
    shortDay: "Mon",
    classes: [
      { id: "mon-0500", time: "5:00 AM", program: "CrossFit" },
      { id: "mon-0615", time: "6:15 AM", program: "CrossFit" },
      { id: "mon-0730", time: "7:30 AM", program: "CrossFit" },
      { id: "mon-0900", time: "9:00 AM", program: "CrossFit" },
      { id: "mon-1200", time: "12:00 PM", program: "CrossFit" },
      { id: "mon-1600", time: "4:00 PM", program: "CrossFit" },
      { id: "mon-1715", time: "5:15 PM", program: "CrossFit" },
      { id: "mon-1830", time: "6:30 PM", program: "CrossFit" }
    ]
  },
  {
    day: "Tuesday",
    shortDay: "Tue",
    classes: [
      { id: "tue-0500", time: "5:00 AM", program: "CrossFit" },
      { id: "tue-0615", time: "6:15 AM", program: "CrossFit" },
      { id: "tue-0730", time: "7:30 AM", program: "CrossFit" },
      { id: "tue-0900", time: "9:00 AM", program: "CrossFit" },
      { id: "tue-1200", time: "12:00 PM", program: "CrossFit" },
      { id: "tue-1600", time: "4:00 PM", program: "CrossFit" },
      { id: "tue-1715", time: "5:15 PM", program: "CrossFit" },
      { id: "tue-1830", time: "6:30 PM", program: "CrossFit" }
    ]
  },
  {
    day: "Wednesday",
    shortDay: "Wed",
    classes: [
      { id: "wed-0500", time: "5:00 AM", program: "CrossFit" },
      { id: "wed-0615", time: "6:15 AM", program: "CrossFit" },
      { id: "wed-0730", time: "7:30 AM", program: "CrossFit" },
      { id: "wed-0900", time: "9:00 AM", program: "CrossFit" },
      { id: "wed-1200", time: "12:00 PM", program: "CrossFit" },
      { id: "wed-1600", time: "4:00 PM", program: "CrossFit" },
      { id: "wed-1715", time: "5:15 PM", program: "CrossFit" },
      { id: "wed-1830", time: "6:30 PM", program: "CrossFit" }
    ]
  },
  {
    day: "Thursday",
    shortDay: "Thu",
    classes: [
      { id: "thu-0500", time: "5:00 AM", program: "CrossFit" },
      { id: "thu-0615", time: "6:15 AM", program: "CrossFit" },
      { id: "thu-0730", time: "7:30 AM", program: "CrossFit" },
      { id: "thu-0900", time: "9:00 AM", program: "CrossFit" },
      { id: "thu-1200", time: "12:00 PM", program: "CrossFit" },
      { id: "thu-1600", time: "4:00 PM", program: "CrossFit" },
      { id: "thu-1715", time: "5:15 PM", program: "CrossFit" },
      { id: "thu-1830", time: "6:30 PM", program: "CrossFit" }
    ]
  },
  {
    day: "Friday",
    shortDay: "Fri",
    classes: [
      { id: "fri-0500", time: "5:00 AM", program: "CrossFit" },
      { id: "fri-0615", time: "6:15 AM", program: "CrossFit" },
      { id: "fri-0730", time: "7:30 AM", program: "CrossFit" },
      { id: "fri-0900", time: "9:00 AM", program: "CrossFit" },
      { id: "fri-1200", time: "12:00 PM", program: "CrossFit" },
      { id: "fri-1500", time: "3:00 PM", program: "CrossFit" },
      { id: "fri-1615", time: "4:15 PM", program: "CrossFit" },
      { id: "fri-1730", time: "5:30 PM", program: "CrossFit" }
    ]
  },
  {
    day: "Saturday",
    shortDay: "Sat",
    classes: [
      { id: "sat-0800", time: "8:00 AM", program: "CrossFit" },
      { id: "sat-0930", time: "9:30 AM", program: "CrossFit" }
    ]
  },
  {
    day: "Sunday",
    shortDay: "Sun",
    classes: [
      { id: "sun-0830", time: "8:30 AM", program: "CrossFit" },
      { id: "sun-0945", time: "9:45 AM", program: "CrossFit" }
    ]
  }
];
