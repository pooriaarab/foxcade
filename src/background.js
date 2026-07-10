const DAILY_ALARM_NAME = "foxcade-daily-reminder";
const DAILY_NOTIFICATION_ID = "foxcade-daily-ready";
const api = globalThis.browser ?? globalThis.chrome;

function feedUrl() {
  return api?.runtime?.getURL ? api.runtime.getURL("feed.html") : "feed.html";
}

function openFeed() {
  if (api?.tabs?.create) api.tabs.create({ url: feedUrl() });
}

function showDailyNotification() {
  if (!api?.notifications?.create) return;
  try {
    const created = api.notifications.create(DAILY_NOTIFICATION_ID, {
      type: "basic",
      title: "Today's foxcade is ready",
      message: "Open the daily game."
    });
    if (created?.catch) created.catch(e => console.error("background: notification failed", e));
  } catch (e) {
    console.error("background: notification failed", e);
  }
}

if (api?.action?.onClicked?.addListener) {
  api.action.onClicked.addListener(openFeed);
}

if (api?.alarms?.onAlarm?.addListener) {
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name === DAILY_ALARM_NAME) showDailyNotification();
  });
}

if (api?.notifications?.onClicked?.addListener) {
  api.notifications.onClicked.addListener(notificationId => {
    if (notificationId !== DAILY_NOTIFICATION_ID) return;
    openFeed();
    try {
      if (api?.notifications?.clear) api.notifications.clear(notificationId);
    } catch (e) {
      console.error("background: notification clear failed", e);
    }
  });
}
