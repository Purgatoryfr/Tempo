use std::{thread, time::Duration};

use chrono::{Datelike, Local, Timelike, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::store::AppState;

#[derive(Clone, Serialize)]
struct Ring {
    kind: &'static str,
    id: String,
    label: String,
    sound: String,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        tick(&app);
    });
}

fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let local = Local::now();
    let now = Utc::now();
    let minute_key = local.format("%Y-%m-%d %H:%M").to_string();
    let weekday = local.weekday().num_days_from_monday();

    let mut rings = Vec::new();
    let mut guard = state.store.lock().unwrap();
    let mut changed = false;

    for alarm in guard.alarms.iter_mut().filter(|a| a.enabled) {
        let snooze_due = alarm.snoozed_until.map_or(false, |until| until <= now);
        let scheduled = alarm.snoozed_until.is_none()
            && alarm.hour == local.hour()
            && alarm.minute == local.minute()
            && (alarm.days.is_empty() || alarm.days.contains(&weekday))
            && alarm.last_fired.as_deref() != Some(minute_key.as_str());

        if snooze_due || scheduled {
            alarm.last_fired = Some(minute_key.clone());
            alarm.snoozed_until = None;
            if alarm.days.is_empty() {
                alarm.enabled = false;
            }
            changed = true;
            rings.push(Ring {
                kind: "alarm",
                id: alarm.id.clone(),
                label: alarm.label.clone(),
                sound: alarm.sound.clone(),
            });
        }
    }

    for timer in guard.timers.iter_mut() {
        if timer.running && timer.ends_at.map_or(false, |end| end <= now) {
            timer.running = false;
            timer.ends_at = None;
            timer.remaining_ms = 0;
            changed = true;
            rings.push(Ring {
                kind: "timer",
                id: timer.id.clone(),
                label: timer.label.clone(),
                sound: timer.sound.clone(),
            });
        }
    }

    let notifications = guard.settings.notifications;
    if changed {
        state.persist(&guard);
        let _ = app.emit("store-changed", guard.clone());
    }
    drop(guard);

    for ring in rings {
        let _ = app.emit("ring", ring.clone());
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        if notifications {
            let title = if ring.kind == "alarm" { "Alarm" } else { "Timer finished" };
            let body = if ring.label.is_empty() { title.to_string() } else { ring.label.clone() };
            let _ = app.notification().builder().title(title).body(body).show();
        }
    }
}
