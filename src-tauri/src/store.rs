use std::{fs, path::PathBuf, sync::Mutex};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Alarm {
    pub id: String,
    pub label: String,
    pub hour: u32,
    pub minute: u32,
    pub days: Vec<u32>,
    pub enabled: bool,
    pub sound: String,
    pub snooze_minutes: u32,
    #[serde(default)]
    pub snoozed_until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_fired: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Timer {
    pub id: String,
    pub label: String,
    pub duration_secs: u64,
    pub remaining_ms: i64,
    pub running: bool,
    #[serde(default)]
    pub ends_at: Option<DateTime<Utc>>,
    pub sound: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub font: String,
    pub time_format: String,
    pub show_seconds: bool,
    pub density: String,
    pub notifications: bool,
    pub minimize_to_tray: bool,
    pub default_sound: String,
    pub ramp_volume: bool,
    pub auto_silence_secs: u32,
    pub snooze_minutes: u32,
    pub world_clocks: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            accent: "#3b5bdb".into(),
            font: "system".into(),
            time_format: "system".into(),
            show_seconds: true,
            density: "comfortable".into(),
            notifications: true,
            minimize_to_tray: true,
            default_sound: "chime".into(),
            ramp_volume: true,
            auto_silence_secs: 30,
            snooze_minutes: 10,
            world_clocks: Vec::new(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Store {
    pub alarms: Vec<Alarm>,
    pub timers: Vec<Timer>,
    pub settings: Settings,
}

pub struct AppState {
    pub store: Mutex<Store>,
    path: PathBuf,
}

impl AppState {
    pub fn load(path: PathBuf) -> Self {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let store = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            store: Mutex::new(store),
            path,
        }
    }

    pub fn persist(&self, store: &Store) {
        if let Ok(bytes) = serde_json::to_vec_pretty(store) {
            let _ = fs::write(&self.path, bytes);
        }
    }

    pub fn mutate<F: FnOnce(&mut Store)>(&self, change: F) -> Store {
        let mut guard = self.store.lock().unwrap();
        change(&mut guard);
        self.persist(&guard);
        guard.clone()
    }
}
