import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

app.get("/api/auth/login", (_req, res) => {
  const tenantId = process.env.AZURE_AD_TENANT_ID ?? "";
  const clientId = process.env.AZURE_AD_CLIENT_ID ?? "";

  const redirectUri = encodeURIComponent(
    `${process.env.AUTH_URL}/api/auth/callback`,
  );

  const state = Math.random().toString(36).substring(2);

  const scopes = [
    "openid",
    "email",
    "profile",
    "User.Read",
    "User.ReadBasic.All",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "Calendars.Read.Shared",
    "Calendars.ReadWrite.Shared",
  ];

  const scopeParam = encodeURIComponent(scopes.join(" "));

  const authURL = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=${scopeParam}&state=${state}&prompt=consent`;

  console.log("Redirecting the user to the URL", authURL);

  return res.redirect(authURL);
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.json({ error: "Authentication code missing" });
  }

  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const redirectUri = `${process.env.AUTH_URL}/api/auth/callback`;

  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append(
    "scope",
    "User.Read openid email profile Calendars.Read Calendars.ReadWrite User.ReadBasic.All Calendars.Read.Shared Calendars.ReadWrite.Shared",
  );
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("grant_type", "authorization_code");
  params.append("client_secret", clientSecret);

  try {
    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description);
    }

    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 2);

    res.cookie(
      "session",
      JSON.stringify({
        user: {
          name: userData.displayName,
          email: userData.mail,
        },
        accessToken: tokenData.access_token,
      }),
      {
        expires: expiresAt,
        path: "/",
      },
    );

    res.redirect("http://localhost:3000/profile");
  } catch (error) {
    console.log("Auth Error", error);
    res.json({ error: "Authentication error" });
  }
});

app.get("/api/users", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const graphUrl = "https://graph.microsoft.com/v1.0/users";

  try {
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch users",
      details: error.message,
    });
  }
});

app.get("/api/rooms", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const graphUrl =
    "https://graph.microsoft.com/v1.0/places/microsoft.graph.room";

  try {
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch rooms",
      details: error.message,
    });
  }
});

app.get("/api/calendar/events", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }
  const start = req.query.start;
  const end = req.query.end;

  if (!start || !end) {
    return res.status(400).json({
      error: "Missing required fields: start or end.",
    });
  }

  const userId = req.query.userId;

  const graphUrl = userId
    ? `https://graph.microsoft.com/v1.0/users/${userId}/calendar/calendarView?startDateTime=${start}&endDateTime=${end}`
    : `https://graph.microsoft.com/v1.0/me/calendar/calendarView?startDateTime=${start}&endDateTime=${end}&$top=10000`;

  console.log("graphUrl", graphUrl);

  try {
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const events = await response.json();

    const myCalendarEvents = events.value;

    // Return the events data as JSON
    return res.json(myCalendarEvents);
  } catch (error) {
    console.log("Error fetching calendar events", error);

    // Handle any unexpected errors
    return res.status(500).json({
      error: "Failed to fetch events",
      details: error.message,
    });
  }
});

async function getAttachments(eventId, accessToken) {
  if (!eventId) {
    return [];
  }

  try {
    const graphURL = `https://graph.microsoft.com/v1.0/me/events/${eventId}/attachments`;

    const response = await fetch(graphURL, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error fetching attachments", errorText);
      return [];
    }

    const attachments = await response.json();

    return attachments.value;
  } catch (error) {
    console.error("Error fetching attachments", error);
    return [];
  }
}

async function addAttachmentsToEvent(eventId, attachments, accessToken) {
  if (!eventId || !attachments || attachments.length === 0) {
    return;
  }

  try {
    const graphURL = `https://graph.microsoft.com/v1.0/me/events/${eventId}/attachments`;

    const promises = attachments.map((attachment) => {
      return fetch(graphURL, {
        method: "POST",
        headers: {
          Authorization: accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.name,
          contentType: attachment.contentType,
          contentBytes: attachment.contentBypes,
        }),
      });
    });

    const responses = await Promise.all(promises);

    const responseTexts = await Promise.all(
      responses.map((response) => response.text()),
    );

    return responseTexts;
  } catch (error) {
    console.error("Error adding attachments to event", error);
    return [];
  }
}

app.post("/api/calendar/events", async (req, res) => {
  console.log("Request Body", req.body);

  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  try {
    const {
      title,
      description,
      start,
      end,
      selectedAttendees,
      selectedRoom,
      priority = "normal",
      type = "online",
      isOnline = true,
      meetingOwnerId = "",
      recurrence = {},
      previousMeetingId,
    } = req.body;

    if (!title || !description || !start || !end) {
      return res.status(400).json({
        error: "Missing required fields: title, description, start, or end.",
      });
    }

    const graphUrl = meetingOwnerId
      ? `https://graph.microsoft.com/v1.0/users/${meetingOwnerId}/calendar/events`
      : "https://graph.microsoft.com/v1.0/me/events";

    const requestBody = {
      subject: title,
      body: {
        contentType: "HTML",
        content: description || "",
      },
      start: {
        dateTime: start,
        timeZone: "UTC",
      },
      end: {
        dateTime: end,
        timeZone: "UTC",
      },
      attendees: [],
      location: {},
    };

    if (Object.keys(recurrence).length > 0) {
      // TODO: Validate recurrence object
      requestBody.recurrence = recurrence;
    }

    if (selectedAttendees) {
      requestBody.attendees = selectedAttendees.map((attendee) => ({
        emailAddress: {
          address: attendee,
        },
        type: "required",
      }));
    }

    if (selectedRoom) {
      requestBody.location = {
        displayName: selectedRoom,
      };
    }

    if (priority) {
      requestBody.importance = priority;
    }

    requestBody.isOnlineMeeting = isOnline;

    if (type) {
      requestBody.categories = [type];
    }

    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const eventData = await response.json();

    if (!previousMeetingId) {
      return res.status(201).json(eventData);
    }

    const attachments = await getAttachments(previousMeetingId, accessToken);

    if (attachments.length < 1) {
      return res.status(201).json(eventData);
    }

    const attachmentResponse = await addAttachmentsToEvent(
      eventData.id,
      attachments,
      accessToken
    );

    console.log("Attachment Response", attachmentResponse);

    return res.status(201).json({
      ...eventData,
      attachments: attachmentResponse,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to create event",
      details: error.message,
    });
  }
});

app.post("/api/calendar/events/oof", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  try {
    const { title, reason, start, end, recurrence } = req.body;

    if (!title || !start || !end) {
      return res.status(400).json({
        error: "Missing required fields: title, start, or end.",
      });
    }

    const graphUrl = "https://graph.microsoft.com/v1.0/me/events";
    const requestBody = {
      subject: title,
      body: {
        contentType: "HTML",
        content: reason || "",
      },
      start: {
        dateTime: start,
        timeZone: "UTC",
      },
      end: {
        dateTime: end,
        timeZone: "UTC",
      },
      showAs: "oof",
      attendees: [],
      location: {},
      categories: ["oof"],
    };

    if (Object.keys(recurrence).length > 0) {
      // TODO: Validate recurrence object
      requestBody.recurrence = recurrence;
    }

    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.log("Error creating OOF event", response);
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const eventData = await response.json();
    return res.status(201).json(eventData);
  } catch (error) {
    console.log("Error creating OOF event", error);

    return res.status(500).json({
      error: "Failed to create oof event",
      details: error.message,
    });
  }
});

app.post("/api/calendar/events/reminder", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  try {
    const { title, description, start, end, recurrence } = req.body;

    if (!title || !start || !end) {
      return res.status(400).json({
        error: "Missing required fields: title, start, or end.",
      });
    }

    const graphUrl = "https://graph.microsoft.com/v1.0/me/events";
    const requestBody = {
      subject: title,
      body: {
        contentType: "HTML",
        content: description || "",
      },
      start: {
        dateTime: start,
        timeZone: "UTC",
      },
      end: {
        dateTime: end,
        timeZone: "UTC",
      },
      attendees: [],
      location: {},
      reminderMinutesBeforeStart: 30,
      isReminderOn: true,
      categories: ["reminder"],
    };

    if (Object.keys(recurrence).length > 0) {
      // TODO: Validate recurrence object
      requestBody.recurrence = recurrence;
    }

    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const eventData = await response.json();
    return res.status(201).json(eventData);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to create reminder event",
      details: error.message,
    });
  }
});

app.post("/api/calendar/events/:id/accept", async (req, res) => {
  const eventId = req.params.id;
  const accessToken = req.header("Authorization");

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: "Please add comment!" });
  }

  const graphURL = `https://graph.microsoft.com/v1.0/me/events/${eventId}/microsoft.graph.accept`;

  try {
    const response = await fetch(graphURL, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const responseText = await response.text();
    return res.json(responseText);
  } catch (error) {
    console.error("Error in accepting the event", error);
    return res
      .status(500)
      .json({ error: "Error in accepting the event", details: error.message });
  }
});

app.post("/api/calendar/events/:id/decline", async (req, res) => {
  const eventId = req.params.id;
  const accessToken = req.header("Authorization");

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: "Please add comment!" });
  }

  const graphURL = `https://graph.microsoft.com/v1.0/me/events/${eventId}/microsoft.graph.decline`;

  try {
    const response = await fetch(graphURL, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const responseText = await response.text();
    return res.json(responseText);
  } catch (error) {
    console.error("Error in declining the event", error);
    return res
      .status(500)
      .json({ error: "Error in declining the event", details: error.message });
  }
});

app.post("/api/calendar/events/:id/cancel", async (req, res) => {
  const eventId = req.params.id;
  const accessToken = req.header("Authorization");

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: "Please add comment!" });
  }

  const graphURL = `https://graph.microsoft.com/v1.0/me/events/${eventId}/microsoft.graph.cancel`;

  try {
    const response = await fetch(graphURL, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const responseText = await response.text();
    return res.json(responseText);
  } catch (error) {
    console.error("Error in canceling the event", error);
    return res
      .status(500)
      .json({ error: "Error in canceling the event", details: error.message });
  }
});

app.get("/api/calendar/analytics", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }
  const start = req.query.start;
  const end = req.query.end;

  const totalMeetingHoursThreshold = Number(req.query.totalMeetingHours);
  const internalMeetingsThreshold = Number(req.query.internalMeetingsThreshold);
  const externalMeetingsThreshold = Number(req.query.externalMeetingsThreshold);

  if (
    !start ||
    !end ||
    !totalMeetingHoursThreshold ||
    !internalMeetingsThreshold ||
    !externalMeetingsThreshold
  ) {
    return res.status(400).json({
      error:
        "Missing required fields: start, end, totalMeetingHours, internalMeetingsThreshold, or externalMeetingsThreshold.",
    });
  }

  const userId = req.query.userId;

  const graphUrl = userId
    ? `https://graph.microsoft.com/v1.0/users/${userId}/calendar/calendarView?startDateTime=${start}&endDateTime=${end}`
    : `https://graph.microsoft.com/v1.0/me/calendar/calendarView?startDateTime=${start}&endDateTime=${end}&$top=10000`;

  console.log("graphUrl", graphUrl);

  try {
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const events = await response.json();

    const calendarEvents = events.value;

    const thresholdSettings = {
      totalMeetingHours: totalMeetingHoursThreshold,
      internalMeetingsThreshold,
      externalMeetingsThreshold,
    };

    // Initialize an array to hold the weekly meeting counts
    const weeklyMeetingCounts = [
      { week: "Week 1", internal: 0, external: 0, total: 0 },
      { week: "Week 2", internal: 0, external: 0, total: 0 },
      { week: "Week 3", internal: 0, external: 0, total: 0 },
      { week: "Week 4", internal: 0, external: 0, total: 0 },
      { week: "Week 5", internal: 0, external: 0, total: 0 },
    ];

    const meetingDistribution = [
      { name: "High Priority", value: 0 },
      { name: "Medium Priority", value: 0 },
      { name: "Low Priority", value: 0 },
    ];

    const availableVsUsedHours = [
      { week: "Week 1", internal: 0, external: 0, available: 40 },
      { week: "Week 2", internal: 0, external: 0, available: 40 },
      { week: "Week 3", internal: 0, external: 0, available: 40 },
      { week: "Week 4", internal: 0, external: 0, available: 40 },
      { week: "Week 5", internal: 0, external: 0, available: 40 },
    ];

    let totalMeetings = 0;
    let totalMeetingHours = 0;
    let weeksExceedingThreshold = 0;
    let meetingsExceedingThresholdPercentage = 0;
    let currentMeetingHoursPercentage = 0;

    const isInternalMeeting = (event) => {
      const categories = Array.isArray(event.categories)
        ? event.categories
        : [];
      const organizer =
        event.organizer &&
        event.organizer.emailAddress &&
        event.organizer.emailAddress.address;
      const attendees = Array.isArray(event.attendees) ? event.attendees : [];

      if (categories.length > 0) {
        const normalizedCategories = categories.map((cat) => cat.toLowerCase());

        if (normalizedCategories.includes("external")) return false;
        if (
          normalizedCategories.includes("internal") ||
          normalizedCategories.includes("online")
        )
          return true;
        if (normalizedCategories.includes("in-person")) return false;
      }

      if (organizer && attendees.length > 0) {
        const organizerDomain = organizer.split("@")[1];

        const allMatch = attendees.every((attendee) => {
          const address =
            attendee.emailAddress && attendee.emailAddress.address;
          return address ? address.split("@")[1] === organizerDomain : false;
        });

        return allMatch;
      }

      return true;
    };

    // Process each event
    calendarEvents.forEach((event) => {
      totalMeetings += 1;
      const eventDate = new Date(event.start.dateTime);
      const weekNumber = Math.ceil(eventDate.getDate() / 7); // Determine the week number

      if (weekNumber >= 1 && weekNumber <= 5) {
        const weekIndex = weekNumber - 1;

        if (isInternalMeeting(event)) {
          weeklyMeetingCounts[weekIndex].internal += 1;
        } else {
          weeklyMeetingCounts[weekIndex].external += 1;
        }
        weeklyMeetingCounts[weekIndex].total += 1;

        const startDateTime = new Date(event.start.dateTime);
        const endDateTime = new Date(event.end.dateTime);
        const durationInHours =
          Math.floor(endDateTime - startDateTime) / (1000 * 60 * 60);

        totalMeetingHours += durationInHours;

        if (isInternalMeeting(event)) {
          console.log("\n\nInternal Meeting Duration", durationInHours);
          console.log("\n\n");
          availableVsUsedHours[weekIndex].internal += durationInHours;
        } else {
          availableVsUsedHours[weekIndex].external += durationInHours;
        }
      }

      switch (event.importance) {
        case "high":
          meetingDistribution[0].value += 1;
          break;
        case "normal":
          meetingDistribution[1].value += 1;
          break;
        case "low":
          meetingDistribution[2].value += 1;
          break;
      }
    });

    availableVsUsedHours.forEach((week) => {
      week.available -= week.internal + week.external;

      if (
        week.internal > thresholdSettings.internalMeetingsThreshold ||
        week.external > thresholdSettings.externalMeetingsThreshold ||
        week.internal + week.external > thresholdSettings.totalMeetingHours
      ) {
        weeksExceedingThreshold += 1;
      }
    });

    const totalAvailableHours = availableVsUsedHours.reduce(
      (acc, week) => acc + week.available,
      0,
    );

    currentMeetingHoursPercentage = Math.floor(
      (totalMeetingHours / totalAvailableHours) * 100,
    );

    meetingsExceedingThresholdPercentage =
      (weeksExceedingThreshold / availableVsUsedHours.length) * 100;

    console.log("\n\nWeekly Meeting Counts", weeklyMeetingCounts);
    console.log("\n\n");

    console.log("\n\nMeeting Distribution", meetingDistribution);
    console.log("\n\n");

    console.log("\n\nAvailable vs Used Hours", availableVsUsedHours);
    console.log("\n\n");

    console.log("\n\nTotal Meetings", totalMeetings);
    console.log("\n\n");

    console.log("\n\nTotal Meetings Hours", totalMeetingHours);
    console.log("\n\n");

    console.log(
      "\n\nMeetings Exceeding Threshold Percentage",
      meetingsExceedingThresholdPercentage,
    );
    console.log("\n\n");

    // Return the processed data as JSON
    return res.json({
      totalMeetings,
      totalMeetingHours,
      meetingCountData: weeklyMeetingCounts,
      meetingDistributionData: meetingDistribution,
      availableVsUsedHoursData: availableVsUsedHours,
      meetingsExceedingThreshold: meetingsExceedingThresholdPercentage,
      currentMeetingHoursPercentage: currentMeetingHoursPercentage,
    });
  } catch (error) {
    console.log("Error fetching calendar events", error);

    // Handle any unexpected errors
    return res.status(500).json({
      error: "Failed to fetch events",
      details: error.message,
    });
  }
});

function processEvents(events) {
  const recurringEventsMap = new Map();
  const finalEvents = [];

  events.forEach((event) => {
    if (event.seriesMasterId) {
      recurringEventsMap.set(event.seriesMasterId, event);
    } else {
      finalEvents.push(event);
    }
  });

  const lastRecurringEvents = Array.from(recurringEventsMap.values());

  return [...finalEvents, ...lastRecurringEvents];
}

app.get("/api/calendar/previous-events", async (req, res) => {
  const accessToken = req.headers["authorization"];

  if (!accessToken) {
    return res.status(401).json({ error: "Access token is missing." });
  }

  const search = req.query.search;

  const start = new Date();
  const end = new Date();

  const timePeriod = search ? 30 * 12 : 14;

  start.setDate(end.getDate() - timePeriod);

  let graphUrl = `https://graph.microsoft.com/v1.0/me/calendar/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$top=100000`;

  if (search) {
    graphUrl += `&$filter=contains(subject, '${search}')`;
  }

  console.log("graphUrl", graphUrl);

  try {
    const response = await fetch(graphUrl, {
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const events = await response.json();

    const calendarEvents = events.value;

    const processedEvents = processEvents(calendarEvents);

    console.log("\n\nProcessed Events", processedEvents);
    console.log("\n\n");

    return res.json(processedEvents);
  } catch (error) {
    console.log("Error fetching calendar events", error);

    // Handle any unexpected errors
    return res.status(500).json({
      error: "Failed to fetch events",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
