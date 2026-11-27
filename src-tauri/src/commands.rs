use chrono::{Duration, Utc};
use tauri::State;

use crate::store::{Alarm, AppState, Settings, Store, Timer};

#[tauri::command]
pub fn get_store(state: State<AppState>) -> Store {
    state.store.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_alarm(state: State<AppState>, alarm: Alarm) -> Store {
    state.mutate(|store| match store.alarms.iter_mut().find(|a| a.id == alarm.id) {
        Some(existing) => *existing = alarm,
        None => store.alarms.push(alarm),
    })
}

#[tauri::command]
pub fn delete_alarm(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| store.alarms.retain(|a| a.id != id))
}

#[tauri::command]
pub fn set_alarm_enabled(state: State<AppState>, id: String, enabled: bool) -> Store {
    state.mutate(|store| {
        if let Some(alarm) = store.alarms.iter_mut().find(|a| a.id == id) {
            alarm.enabled = enabled;
            alarm.snoozed_until = None;
        }
    })
}

#[tauri::command]
pub fn snooze_alarm(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| {
        if let Some(alarm) = store.alarms.iter_mut().find(|a| a.id == id) {
            alarm.enabled = true;
            alarm.snoozed_until = Some(Utc::now() + Duration::minutes(alarm.snooze_minutes as i64));
        }
    })
}

#[tauri::command]
pub fn dismiss_alarm(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| {
        if let Some(alarm) = store.alarms.iter_mut().find(|a| a.id == id) {
            alarm.snoozed_until = None;
        }
    })
}

#[tauri::command]
pub fn save_timer(state: State<AppState>, mut timer: Timer) -> Store {
    state.mutate(|store| match store.timers.iter_mut().find(|t| t.id == timer.id) {
        Some(existing) => {
            if !existing.running {
                timer.remaining_ms = timer.duration_secs as i64 * 1000;
            } else {
                timer.remaining_ms = existing.remaining_ms;
                timer.ends_at = existing.ends_at;
                timer.running = true;
            }
            *existing = timer;
        }
        None => {
            timer.remaining_ms = timer.duration_secs as i64 * 1000;
            timer.running = false;
            timer.ends_at = None;
            store.timers.push(timer);
        }
    })
}

#[tauri::command]
pub fn start_timer(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| {
        if let Some(timer) = store.timers.iter_mut().find(|t| t.id == id) {
            if !timer.running {
                if timer.remaining_ms <= 0 {
                    timer.remaining_ms = timer.duration_secs as i64 * 1000;
                }
                timer.ends_at = Some(Utc::now() + Duration::milliseconds(timer.remaining_ms));
                timer.running = true;
            }
        }
    })
}

#[tauri::command]
pub fn pause_timer(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| {
        if let Some(timer) = store.timers.iter_mut().find(|t| t.id == id) {
            if let (true, Some(ends_at)) = (timer.running, timer.ends_at) {
                timer.remaining_ms = (ends_at - Utc::now()).num_milliseconds().max(0);
                timer.running = false;
                timer.ends_at = None;
            }
        }
    })
}

#[tauri::command]
pub fn reset_timer(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| {
        if let Some(timer) = store.timers.iter_mut().find(|t| t.id == id) {
            timer.remaining_ms = timer.duration_secs as i64 * 1000;
            timer.running = false;
            timer.ends_at = None;
        }
    })
}

#[tauri::command]
pub fn delete_timer(state: State<AppState>, id: String) -> Store {
    state.mutate(|store| store.timers.retain(|t| t.id != id))
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: Settings) -> Store {
    state.mutate(|store| store.settings = settings)
}

#[tauri::command]
pub fn reset_settings(state: State<AppState>) -> Store {
    state.mutate(|store| store.settings = Settings::default())
}
