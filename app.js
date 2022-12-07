require("dotenv").config();
const ical = require('node-ical');
const { OAuthClient } = require("@timetreeapp/web-api");
const fs = require("fs");
const moment = require("moment");
require('moment-timezone');
const { JsonDB, Config } = require('node-json-db');
const db = new JsonDB(new Config("db", true, true, '/'));
moment.tz.setDefault('Asia/Tokyo');

const timetreeClient = new OAuthClient(process.env.TIMETREE_TOKEN);

const debugLog = (context) => {
  if (process.env.NODE_ENV === "development") {
    return console.log(context);
  }
}

const generateOptions = (webEvent) => ({
  calendarId: process.env.TIMETREE_CALENDAR_ID,
  title: webEvent.summary,
  category: "schedule",
  description: `${process.env.BOT_NAME ?? "ics-to-timetree"}より作成`,
  allDay: Boolean(webEvent.start.dateOnly),
  startAt: webEvent.start.dateOnly ? moment(webEvent.start).startOf("day") : webEvent.start,
  startTimezone: "Asia/Tokyo",
  endAt: !webEvent.start.dateOnly ? webEvent.end : moment(webEvent.start).startOf("day"),
  endTimezone: "Asia/Tokyo",
  label: {
    id: 1
  }
});

(async () => {
  const webEvents = await ical.async.fromURL(process.env.ICS_URL);
  const currentEvents = Object.values(webEvents).filter(v => moment(new Date()).diff(moment(v.start)) < 0);
  for (const webEvent of Object.values(webEvents)) {
    if (moment(webEvent.start).diff(moment(new Date())) < 0 || !webEvent.uid || !webEvent.start || !webEvent.end) {
      continue;
    }
    let relation = null;
    try {
      debugLog(webEvent.uid);
      relation = await db.getData(`/relations/${webEvent.uid}`);
    } catch (e) {
      debugLog("Not found");
    }
    let timetreeEvent = null;
    debugLog(relation);
    if (relation) {
      try {
        timetreeEvent = await timetreeClient.getEvent({
          eventId: relation.ids.timetree,
          calendarId: process.env.TIMETREE_CALENDAR_ID
        });
      } catch (e) {
        debugLog(e.response.data);
        if (e.response?.data?.status !== 404) {
          exit(1);
        }
      }

    }

    if (!timetreeEvent) {
      debugLog({
        calendarId: process.env.TIMETREE_CALENDAR_ID,
        title: webEvent.summary,
        category: "schedule",
        description: `${process.env.BOT_NAME ?? "ics-to-timetree"}より作成`
      });
      const options = generateOptions(webEvent);
      let result;
      try{
        result = await timetreeClient.createEvent(options);
      }catch(e){
        console.error(e.response.data);
        exit(1);
      }
      await db.push(`/relations/${webEvent.uid}`, {
        ids: {
          webEvent: webEvent.uid,
          timetree: result.id,
        },
        time: {
          startAt: webEvent.start,
          endAt: webEvent.end
        },
        title: webEvent.summary
      });
    } else {
      const options = generateOptions(webEvent);
      if (["startAt", "endAt"].some(key => (console.log(moment(options[key]).isSame(timetreeEvent[key]))))) {
        // Change
        try {
          await timetreeClient.updateEvent({ eventId: timetreeEvent.id, ...options });
        } catch (e) {
          console.error(e.response.data);
          debugLog(options);
          exit(1);
        }
      }
    }
  }
  debugLog("calendars", currentEvents);
})();