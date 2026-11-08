mod account_profile;
pub mod airer;
pub mod auth;
pub mod bath_heater;
pub mod camera;
pub mod capabilities;
pub mod ceiling_fan;
pub mod cloud;
mod countdown_write;
pub mod crypto;
pub mod device_events;
pub mod dispenser;
pub mod dispenser_config;
pub mod dispenser_dnd;
pub mod dispenser_history;
pub mod dispenser_reminders;
pub mod dispenser_selfcheck;
pub mod dispenser_selfcheck_history;
pub mod dispenser_sterilization;
pub mod energy;
pub mod error;
pub mod fridge;
pub mod fryer;
pub mod fryer_control;
pub mod history;
mod history_range;
pub mod home_cards;
pub mod ir_remote;
pub mod light_favorites;
pub mod light_modes;
pub mod light_settings;
pub mod media_storage;
mod metadata_cache;
pub mod models;
pub mod monitor;
#[cfg(feature = "desktop")]
mod monitor_window;
pub mod order;
pub mod preferences;
mod platform_paths;
pub mod purifier;
pub mod purifier_dnd;
pub mod purifier_history;
pub mod purifier_options;
pub mod router;
pub mod router_access;
pub mod router_advanced;
pub mod router_block_records;
pub mod router_classification;
pub mod router_client_name;
pub mod router_connection;
pub mod router_daily;
pub mod router_family;
pub mod router_indicator;
pub mod router_internet;
pub mod router_network;
pub mod router_password;
pub mod router_qos;
pub mod router_radio;
pub mod router_scene;
pub mod router_url;
pub mod router_whitelist;
pub mod router_wifi;
pub mod scale;
pub mod speaker;
pub mod spec;
pub mod state;
pub mod switch_mode;
mod timer_write;
pub mod timers;
mod ui_resource_cache;
pub mod ui_resources;
pub mod vacuum;
pub mod washer;
pub mod washer_command;
pub mod washer_programs;
pub mod washer_records;
pub mod washer_runtime;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::preferences::{PreferenceChange, PreferenceView};
    use crate::{error::Result, models::*, state::AppState};
    use tauri::Manager;
    #[tauri::command]
    async fn media_storage() -> Result<crate::media_storage::View> {
        tauri::async_runtime::spawn_blocking(crate::media_storage::get)
            .await
            .map_err(|_| crate::error::AppError::invalid("无法读取媒体保存位置。"))?
    }
    #[tauri::command]
    async fn open_media_storage() -> Result<()> {
        tauri::async_runtime::spawn_blocking(crate::media_storage::open)
            .await
            .map_err(|_| crate::error::AppError::invalid("无法打开媒体保存位置。"))?
    }
    #[tauri::command]
    async fn reset_media_storage() -> Result<crate::media_storage::View> {
        tauri::async_runtime::spawn_blocking(|| crate::media_storage::set(None))
            .await
            .map_err(|_| crate::error::AppError::invalid("无法恢复默认媒体保存位置。"))?
    }
    #[tauri::command]
    async fn choose_media_storage(
        window: tauri::WebviewWindow,
    ) -> Result<Option<crate::media_storage::View>> {
        #[cfg(target_os = "windows")]
        {
            let owner = window.hwnd()
                .map_err(|_| crate::error::AppError::invalid("无法取得设置窗口。"))?.0 as isize;
            tauri::async_runtime::spawn_blocking(move || crate::media_storage::choose(owner))
                .await.map_err(|_| crate::error::AppError::invalid("文件夹选择窗口意外关闭。"))?
        }
        #[cfg(not(target_os = "windows"))]
        {
            tauri::async_runtime::spawn_blocking(move || crate::media_storage::choose_window(&window))
                .await.map_err(|_| crate::error::AppError::invalid("文件夹选择窗口意外关闭。"))?
        }
    }
    #[tauri::command]
    async fn scale_history(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        account_id: Option<String>,
        before: Option<u64>,
        start: Option<u64>,
        end: Option<u64>,
        summary: Option<bool>,
        unclaimed: Option<bool>,
    ) -> Result<crate::scale::Report> {
        state
            .scale_history(
                home_id,
                generation,
                did,
                account_id,
                before,
                start,
                end,
                summary.unwrap_or(false),
                unclaimed.unwrap_or(false),
            )
            .await
    }
    #[tauri::command]
    async fn change_scale(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
        change: crate::scale::Change,
    ) -> Result<crate::scale::Changed> {
        state
            .change_scale(home_id, generation, did, request_id, change)
            .await
    }
    #[tauri::command]
    async fn vacuum(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::vacuum::Report> {
        state.vacuum(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_vacuum(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: crate::vacuum::Change,
    ) -> Result<crate::vacuum::Changed> {
        state
            .change_vacuum(home_id, generation, did, baseline, change)
            .await
    }
    #[tauri::command]
    async fn camera_care_video(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        event_id: String,
    ) -> Result<crate::camera::cloud_media::Video> {
        state
            .camera_care_video(home_id, generation, did, date, event_id)
            .await
    }
    #[tauri::command]
    async fn camera_cloud_save(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        event_id: String,
    ) -> Result<Option<crate::camera::saved_media::SavedMedia>> {
        let name = state
            .camera_cloud_name(&home_id, generation, &did, &date, &event_id)
            .await?;
        let Some(destination) = camera_save_destination(
            window.app_handle(),
            &window,
            name,
            crate::camera::save_dialog::Kind::Recording,
        )
        .await?
        else {
            return Ok(None);
        };
        state
            .camera_cloud_save(home_id, generation, did, date, event_id, destination)
            .await
            .map(Some)
    }
    #[tauri::command]
    async fn camera_care_thumbnail(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        event_id: String,
    ) -> Result<String> {
        state
            .camera_care_thumbnail(home_id, generation, did, date, event_id)
            .await
    }
    #[tauri::command]
    async fn camera_care(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
    ) -> Result<crate::camera::events::CareReport> {
        state.camera_care(home_id, generation, did, date).await
    }
    #[tauri::command]
    async fn doorbell_cloud(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
    ) -> Result<crate::camera::doorbell_cloud::Report> {
        state.doorbell_cloud(home_id, generation, did, date).await
    }
    #[tauri::command]
    async fn camera_features(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::media_control::Features> {
        state.camera_features(home_id, generation, did).await
    }
    #[tauri::command]
    async fn camera_power(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::power::Snapshot> {
        state.camera_power(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_camera_power(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        awake: bool,
        expected_awake: bool,
    ) -> Result<crate::camera::power::Changed> {
        state
            .change_camera_power(home_id, generation, did, awake, expected_awake)
            .await
    }
    #[tauri::command]
    async fn camera_auxiliary(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::auxiliary::Snapshot> {
        state.camera_auxiliary(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_camera_auxiliary(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::camera::auxiliary::Kind,
        active: bool,
        expected_active: bool,
    ) -> Result<crate::camera::auxiliary::Changed> {
        state
            .change_camera_auxiliary(home_id, generation, did, kind, active, expected_active)
            .await
    }
    async fn camera_save_destination(
        _app: &tauri::AppHandle,
        _window: &tauri::WebviewWindow,
        _name: String,
        kind: crate::camera::save_dialog::Kind,
    ) -> Result<Option<std::path::PathBuf>> {
        tauri::async_runtime::spawn_blocking(move || {
            crate::media_storage::destination(kind).map(Some)
        })
        .await
        .map_err(|_| crate::error::AppError::invalid("无法取得媒体保存位置。"))?
    }
    async fn camera_recording_destination(
        _app: &tauri::AppHandle,
        _name: &str,
    ) -> Result<std::path::PathBuf> {
        tauri::async_runtime::spawn_blocking(|| {
            crate::media_storage::destination(crate::camera::save_dialog::Kind::Recording)
        })
        .await
        .map_err(|_| crate::error::AppError::invalid("无法取得录像保存位置。"))?
    }
    #[tauri::command]
    async fn camera_command(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        operation: crate::camera::media_control::Operation,
    ) -> Result<crate::camera::media_control::Reply> {
        let destination = if matches!(
            operation,
            crate::camera::media_control::Operation::Record { enabled: true, .. }
        ) {
            let name = state
                .camera_media_name(&home_id, generation, &did, &session_id)
                .await?;
            let path = camera_recording_destination(window.app_handle(), &name).await?;
            Some(path)
        } else {
            None
        };
        state
            .camera_command(home_id, generation, did, session_id, operation, destination)
            .await
    }
    #[tauri::command]
    async fn camera_microphone(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        packet: String,
    ) -> Result<()> {
        state
            .camera_microphone(home_id, generation, did, session_id, packet)
            .await
    }
    #[tauri::command]
    async fn camera_screenshot(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        png: String,
    ) -> Result<Option<crate::camera::saved_media::SavedMedia>> {
        let name = state
            .camera_media_name(&home_id, generation, &did, &session_id)
            .await?;
        let Some(destination) = camera_save_destination(
            window.app_handle(),
            &window,
            name,
            crate::camera::save_dialog::Kind::Screenshot,
        )
        .await?
        else {
            return Ok(None);
        };
        state
            .camera_screenshot(home_id, generation, did, session_id, png, destination)
            .await
            .map(Some)
    }
    #[tauri::command]
    async fn camera_media_folder(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        export_id: String,
    ) -> Result<()> {
        state
            .camera_media_folder(home_id, generation, did, export_id)
            .await
    }
    #[tauri::command]
    async fn start_camera(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        quality: Option<String>,
    ) -> Result<String> {
        state.start_camera(home_id, generation, did, quality).await
    }

    #[tauri::command]
    async fn monitor_detail_open(
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
    ) -> Result<crate::monitor::actions::Detail> {
        state.monitor_detail_open(target).await
    }
    #[tauri::command]
    async fn monitor_detail_command(
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
        lease_id: String,
        operation: crate::camera::media_control::Operation,
    ) -> Result<crate::camera::media_control::Reply> {
        state
            .monitor_detail_command(target, lease_id, operation)
            .await
    }
    #[tauri::command]
    async fn monitor_detail_microphone(
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
        lease_id: String,
        packet: String,
    ) -> Result<()> {
        state
            .monitor_detail_microphone(target, lease_id, packet)
            .await
    }
    #[tauri::command]
    async fn monitor_detail_close(
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
        lease_id: String,
    ) -> Result<()> {
        state.monitor_detail_close(target, lease_id).await
    }
    #[tauri::command]
    async fn monitor_window(window: tauri::WebviewWindow, enabled: bool) -> Result<()> {
        crate::monitor_window::set(&window, enabled)
            .await
            .map_err(|_| crate::error::AppError::invalid("无法调整监控窗口比例。"))
    }
    #[tauri::command]
    async fn create_monitor(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        dids: Vec<String>,
    ) -> Result<String> {
        state.create_monitor(home_id, generation, dids).await
    }
    #[tauri::command]
    async fn monitor_command(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
        operation: crate::monitor::actions::Operation,
    ) -> Result<crate::camera::media_control::Reply> {
        let destination = if operation.starts_recording() {
            let name = state.monitor_media_name(&target).await?;
            let path = camera_recording_destination(window.app_handle(), &name).await?;
            Some(path)
        } else {
            None
        };
        state.monitor_command(target, operation, destination).await
    }
    #[tauri::command]
    async fn monitor_screenshot(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, AppState>,
        target: crate::monitor::actions::Target,
        png: String,
    ) -> Result<Option<crate::camera::saved_media::SavedMedia>> {
        let name = state.monitor_media_name(&target).await?;
        let Some(path) = camera_save_destination(
            window.app_handle(),
            &window,
            name,
            crate::camera::save_dialog::Kind::Screenshot,
        )
        .await?
        else {
            return Ok(None);
        };
        state.monitor_screenshot(target, png, path).await.map(Some)
    }
    #[tauri::command]
    async fn read_monitor(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        viewer_id: String,
    ) -> Result<Vec<crate::monitor::Row>> {
        state.read_monitor(home_id, generation, viewer_id).await
    }
    #[tauri::command]
    async fn retry_monitor(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        viewer_id: String,
        did: String,
    ) -> Result<()> {
        state
            .retry_monitor(home_id, generation, viewer_id, did)
            .await
    }
    #[tauri::command]
    async fn stop_monitor(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        viewer_id: String,
    ) -> Result<()> {
        state.stop_monitor(home_id, generation, viewer_id).await
    }
    #[tauri::command]
    async fn read_camera(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
    ) -> Result<Vec<crate::camera::Event>> {
        state
            .read_camera(home_id, generation, did, session_id)
            .await
    }
    #[tauri::command]
    async fn stop_camera(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
    ) -> Result<()> {
        state
            .stop_camera(home_id, generation, did, session_id)
            .await
    }
    use serde_json::Value;
    #[tauri::command]
    async fn session(state: tauri::State<'_, AppState>) -> Result<SessionView> {
        state.session().await
    }
    #[tauri::command]
    async fn account_profile(state: tauri::State<'_, AppState>) -> Result<AccountProfile> {
        state.account_profile().await
    }
    #[tauri::command]
    async fn washer_config(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::washer::WasherConfigReport> {
        state.washer_config(home_id, generation, did).await
    }
    #[tauri::command]
    async fn washer_program_preview(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        draft: crate::washer_programs::ProgramDraft,
    ) -> Result<crate::washer_programs::ProgramPreview> {
        state
            .washer_program_preview(home_id, generation, did, draft)
            .await
    }
    #[tauri::command]
    async fn start_washer_program(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
        draft: crate::washer_programs::ProgramDraft,
    ) -> Result<crate::washer_command::CommandResult> {
        state
            .start_washer_program(home_id, generation, did, request_id, draft)
            .await
    }
    #[tauri::command]
    async fn confirm_washer_program(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
    ) -> Result<crate::washer_command::CommandResult> {
        state
            .confirm_washer_program(home_id, generation, did, request_id)
            .await
    }
    #[tauri::command]
    async fn home_preferences(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
    ) -> Result<PreferenceView> {
        state.home_preferences(home_id, generation, None).await
    }
    #[tauri::command]
    async fn change_home_preferences(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        change: PreferenceChange,
    ) -> Result<PreferenceView> {
        state
            .home_preferences(home_id, generation, Some(change))
            .await
    }
    #[tauri::command]
    async fn start_login(state: tauri::State<'_, AppState>, region: String) -> Result<QrView> {
        state.start_login(region).await
    }
    #[tauri::command]
    async fn poll_login(state: tauri::State<'_, AppState>, attempt_id: String) -> Result<PollView> {
        state.poll_login(attempt_id).await
    }
    #[tauri::command]
    async fn cancel_login(state: tauri::State<'_, AppState>, attempt_id: String) -> Result<()> {
        state.cancel_login(attempt_id).await
    }
    #[tauri::command]
    async fn logout(state: tauri::State<'_, AppState>) -> Result<()> {
        state.logout().await
    }
    #[tauri::command]
    async fn list_homes(state: tauri::State<'_, AppState>) -> Result<Vec<Home>> {
        state.list_homes().await
    }
    #[tauri::command]
    async fn select_home(
        state: tauri::State<'_, AppState>,
        home_id: String,
    ) -> Result<HomeSnapshot> {
        state.select_home(home_id).await
    }
    #[tauri::command]
    async fn refresh_devices(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
    ) -> Result<HomeSnapshot> {
        state.refresh_devices(home_id, generation).await
    }
    #[tauri::command]
    async fn home_cards(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
    ) -> Result<crate::home_cards::HomeCardReport> {
        state.home_cards(home_id, generation).await
    }
    #[tauri::command]
    async fn router_daily(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_daily::Report> {
        state.router_daily(home_id, generation, did).await
    }
    #[tauri::command]
    async fn scan_router_daily(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_daily::Report> {
        state.scan_router_daily(home_id, generation, did).await
    }
    #[tauri::command]
    async fn optimize_router_daily(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
    ) -> Result<crate::router_daily::Report> {
        state
            .optimize_router_daily(home_id, generation, did, baseline)
            .await
    }
    #[tauri::command]
    async fn router_scene(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_scene::Report> {
        state.router_scene(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_scene_history(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::router_scene::Kind,
        days: u8,
        page: u16,
    ) -> Result<crate::router_scene::History> {
        state
            .router_scene_history(home_id, generation, did, kind, days, page)
            .await
    }
    #[tauri::command]
    async fn router_scene_detail(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::router_scene::Kind,
        id: String,
    ) -> Result<crate::router_scene::Row> {
        state
            .router_scene_detail(home_id, generation, did, kind, id)
            .await
    }
    #[tauri::command]
    async fn start_router_scene(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_scene::Change,
    ) -> Result<crate::router_scene::Report> {
        state
            .start_router_scene(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn stop_router_scene(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_scene::Report> {
        state.stop_router_scene(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_overview(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router::RouterReport> {
        state.router_overview(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_network(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::router_network::Kind,
    ) -> Result<crate::router_network::Read> {
        state.router_network(home_id, generation, did, kind).await
    }
    #[tauri::command]
    async fn change_router_network(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_network::Change,
    ) -> Result<crate::router_network::Outcome> {
        state
            .change_router_network(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_network(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_network::Change,
    ) -> Result<crate::router_network::Outcome> {
        state
            .change_router_network(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn acknowledge_router_network(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        id: String,
    ) -> Result<crate::router_network::Read> {
        state
            .acknowledge_router_network(home_id, generation, did, id)
            .await
    }
    #[tauri::command]
    async fn router_internet(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_internet::Read> {
        state.router_internet(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_router_internet(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_internet::Change,
    ) -> Result<crate::router_internet::Outcome> {
        state
            .change_router_internet(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_internet(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_internet::Change,
    ) -> Result<crate::router_internet::Outcome> {
        state
            .change_router_internet(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn router_client_name(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_client_name::Change,
    ) -> Result<crate::router_client_name::Outcome> {
        state
            .router_client_name(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn router_classification(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<crate::router_classification::Read> {
        state
            .read_router_classification(home_id, generation, did, mac)
            .await
    }
    #[tauri::command]
    async fn router_access(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_access::Read> {
        state.read_router_access(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_block_records(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_block_records::Report> {
        state
            .read_router_block_records(home_id, generation, did)
            .await
    }
    #[tauri::command]
    async fn change_router_access(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_access::Change,
    ) -> Result<crate::router_access::Outcome> {
        state
            .change_router_access(home_id, generation, did, change, false, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_access(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_access::Change,
    ) -> Result<crate::router_access::Outcome> {
        state
            .change_router_access(home_id, generation, did, change, true, false)
            .await
    }
    #[tauri::command]
    async fn router_family(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<crate::router_family::Read> {
        state
            .read_router_family(home_id, generation, did, mac)
            .await
    }
    #[tauri::command]
    async fn change_router_family(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_family::Change,
    ) -> Result<crate::router_family::Outcome> {
        state
            .change_router_family(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_family(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_family::Change,
    ) -> Result<crate::router_family::Outcome> {
        state
            .change_router_family(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn router_url(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<crate::router_url::Read> {
        state.read_router_url(home_id, generation, did, mac).await
    }
    #[tauri::command]
    async fn change_router_url(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_url::Change,
    ) -> Result<crate::router_url::Outcome> {
        state
            .change_router_url(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_url(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_url::Change,
    ) -> Result<crate::router_url::Outcome> {
        state
            .change_router_url(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn router_qos(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        mac: Option<String>,
    ) -> Result<crate::router_qos::Read> {
        state.read_router_qos(home_id, generation, did, mac).await
    }
    #[tauri::command]
    async fn router_whitelist_ready(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_whitelist::Readiness> {
        state.router_whitelist_ready(home_id, generation, did).await
    }
    #[tauri::command]
    async fn finish_router_whitelist(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_access::Change,
    ) -> Result<crate::router_access::Outcome> {
        state
            .change_router_access(home_id, generation, did, change, false, true)
            .await
    }
    #[tauri::command]
    async fn change_router_qos(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_qos::Change,
    ) -> Result<crate::router_qos::Outcome> {
        state
            .change_router_qos(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_qos(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_qos::Change,
    ) -> Result<crate::router_qos::Outcome> {
        state
            .change_router_qos(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn change_router_classification(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_classification::Change,
    ) -> Result<crate::router_classification::Outcome> {
        state
            .change_router_classification(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_classification(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_classification::Change,
    ) -> Result<crate::router_classification::Outcome> {
        state
            .change_router_classification(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn confirm_router_client_name(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_client_name::Change,
    ) -> Result<crate::router_client_name::Outcome> {
        state
            .router_client_name(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn router_password(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_password::Report> {
        state.router_password(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_wifi(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_wifi::WifiRead> {
        state.router_wifi(home_id, generation, did).await
    }
    #[tauri::command]
    async fn router_advanced(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_advanced::Read> {
        state.router_advanced(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_router_advanced(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_advanced::Change,
    ) -> Result<crate::router_advanced::Outcome> {
        state
            .change_router_advanced(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_advanced(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_advanced::Change,
    ) -> Result<crate::router_advanced::Outcome> {
        state
            .change_router_advanced(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn respond_router_dfs(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        id: String,
        proceed: bool,
    ) -> Result<crate::router_advanced::Outcome> {
        state
            .respond_router_dfs(home_id, generation, did, id, proceed)
            .await
    }
    #[tauri::command]
    async fn change_router_wifi(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_wifi::WifiChange,
    ) -> Result<crate::router_wifi::WifiResult> {
        state
            .change_router_wifi(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_wifi(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_wifi::WifiChange,
    ) -> Result<crate::router_wifi::WifiResult> {
        state
            .change_router_wifi(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn router_indicator(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_indicator::IndicatorRead> {
        state.router_indicator(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_router_indicator(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_indicator::IndicatorChange,
    ) -> Result<crate::router_indicator::IndicatorResult> {
        state
            .change_router_indicator(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_router_indicator(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_indicator::IndicatorChange,
    ) -> Result<crate::router_indicator::IndicatorResult> {
        state
            .change_router_indicator(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn change_home_card(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        intent: String,
    ) -> Result<crate::home_cards::HomeCardResult> {
        state
            .change_home_card(home_id, generation, did, intent, false)
            .await
    }
    #[tauri::command]
    async fn confirm_home_card(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        intent: String,
    ) -> Result<crate::home_cards::HomeCardResult> {
        state
            .change_home_card(home_id, generation, did, intent, true)
            .await
    }
    #[tauri::command]
    async fn device_panel(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<DevicePanel> {
        state.device_panel(home_id, generation, did).await
    }
    #[tauri::command]
    async fn device_events(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        cursor: Option<String>,
    ) -> Result<crate::device_events::Page> {
        state
            .device_events(home_id, generation, did, date, cursor)
            .await
    }
    #[tauri::command]
    async fn washer_records(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        range: crate::washer_records::LogRange,
        cursor: Option<String>,
    ) -> Result<crate::washer_records::RecordReport> {
        state
            .washer_records(home_id, generation, did, range, cursor)
            .await
    }
    #[tauri::command]
    async fn washer_record_detail(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        range: crate::washer_records::LogRange,
        cursor: Option<String>,
        record_id: String,
    ) -> Result<crate::washer_records::RecordDetail> {
        state
            .washer_record_detail(home_id, generation, did, range, cursor, record_id)
            .await
    }
    #[tauri::command]
    async fn light_modes(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_modes::LightModeReport> {
        state.light_modes(home_id, generation, did).await
    }
    #[tauri::command]
    async fn light_settings(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_settings::LightSettingsReport> {
        state.light_settings(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_light_settings(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_settings::LightSettingsChange,
    ) -> Result<crate::light_settings::LightSettingsResult> {
        state
            .change_light_settings(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn confirm_light_settings(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_settings::LightSettingsChange,
    ) -> Result<crate::light_settings::LightSettingsResult> {
        state
            .confirm_light_settings(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn light_favorites(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_favorites::LightFavoritesReport> {
        state.light_favorites(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_light_favorite(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_favorites::LightFavoriteChange,
    ) -> Result<crate::light_favorites::LightFavoriteResult> {
        state
            .change_light_favorite(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn confirm_light_favorite(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_favorites::LightFavoriteChange,
    ) -> Result<crate::light_favorites::LightFavoriteResult> {
        state
            .confirm_light_favorite(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn device_ui_resources(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::ui_resources::DeviceUiResources> {
        state.device_ui_resources(home_id, generation, did).await
    }
    #[tauri::command]
    async fn reset_fridge(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        expected: crate::fridge::Snapshot,
    ) -> Result<ControlResult> {
        state.reset_fridge(home_id, generation, did, expected).await
    }
    #[tauri::command]
    async fn dispenser_reminders(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_reminders::Report> {
        state.dispenser_reminders(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_dispenser_reminder(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_reminders::Change,
    ) -> Result<crate::dispenser_reminders::ChangeResult> {
        state
            .change_dispenser_reminder(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn dispenser_selfcheck(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_selfcheck::Change,
    ) -> Result<ControlResult> {
        state
            .dispenser_selfcheck(home_id, generation, did, change, false)
            .await
    }
    #[tauri::command]
    async fn confirm_dispenser_selfcheck(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_selfcheck::Change,
    ) -> Result<ControlResult> {
        state
            .dispenser_selfcheck(home_id, generation, did, change, true)
            .await
    }
    #[tauri::command]
    async fn dispenser_selfcheck_records(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_selfcheck_history::Records> {
        state
            .dispenser_selfcheck_records(home_id, generation, did)
            .await
    }
    #[tauri::command]
    async fn dispenser_sterilization(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_sterilization::Change,
    ) -> Result<ControlResult> {
        state
            .dispenser_sterilization(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn change_dispenser(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_config::Change,
    ) -> Result<ControlResult> {
        state
            .change_dispenser(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn dispenser_dnd(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_dnd::Report> {
        state.dispenser_dnd(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_dispenser_dnd(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_dnd::Change,
    ) -> Result<crate::dispenser_dnd::ChangeResult> {
        state
            .change_dispenser_dnd(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn change_fridge(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::fridge::Change,
    ) -> Result<ControlResult> {
        state.change_fridge(home_id, generation, did, change).await
    }
    #[tauri::command]
    async fn airer_lift(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::airer::LiftChange,
    ) -> Result<ControlResult> {
        state.airer_lift(home_id, generation, did, change).await
    }
    #[tauri::command]
    async fn save_airer_night(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::airer::NightChange,
    ) -> Result<ControlResult> {
        state
            .save_airer_night(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn purifier_options(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::purifier_options::Report> {
        state.purifier_options(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_purifier_push(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::purifier_options::Change,
    ) -> Result<crate::purifier_options::ChangeResult> {
        state
            .change_purifier_push(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn purifier_dnd(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::purifier_dnd::Report> {
        state.purifier_dnd(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_purifier_dnd(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::purifier_dnd::Change,
    ) -> Result<crate::purifier_dnd::ChangeResult> {
        state
            .change_purifier_dnd(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn save_purifier_cups(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        expected: String,
        cups: Vec<crate::purifier::Cup>,
    ) -> Result<ControlResult> {
        state
            .save_purifier_cups(home_id, generation, did, expected, cups)
            .await
    }
    #[tauri::command]
    async fn read_properties(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<DevicePanel> {
        state.device_panel(home_id, generation, did).await
    }
    #[tauri::command]
    async fn dispenser_records(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        before: Option<u64>,
    ) -> Result<crate::dispenser_history::Records> {
        state
            .dispenser_records(home_id, generation, did, before)
            .await
    }
    #[tauri::command]
    async fn dispenser_statistics(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        selection: crate::dispenser_history::Selection,
    ) -> Result<crate::dispenser_history::Statistics> {
        state
            .dispenser_statistics(home_id, generation, did, selection)
            .await
    }
    #[tauri::command]
    async fn purifier_records(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        query: crate::purifier_history::RecordQuery,
    ) -> Result<crate::purifier_history::RecordPage> {
        state
            .purifier_records(home_id, generation, did, query)
            .await
    }
    #[tauri::command]
    async fn purifier_statistics(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        selection: crate::purifier_history::Selection,
    ) -> Result<crate::purifier_history::Statistics> {
        state
            .purifier_statistics(home_id, generation, did, selection)
            .await
    }
    #[tauri::command]
    async fn sensor_history(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<SensorHistory> {
        state.sensor_history(home_id, generation, did).await
    }
    #[tauri::command]
    async fn history_detail(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        selection: HistorySelection,
    ) -> Result<SensorHistory> {
        state
            .history_detail(home_id, generation, did, selection)
            .await
    }
    #[tauri::command]
    async fn speaker_player(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::speaker::Player> {
        state.speaker_player(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_speaker(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::speaker::Change,
    ) -> Result<()> {
        state.change_speaker(home_id, generation, did, change).await
    }
    #[tauri::command]
    async fn bath_heater(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::bath_heater::Report> {
        state.bath_heater(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_bath_heater(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: crate::bath_heater::Change,
    ) -> Result<crate::bath_heater::Changed> {
        state
            .change_bath_heater(home_id, generation, did, baseline, change)
            .await
    }
    #[tauri::command]
    async fn fryer(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::fryer_control::Snapshot> {
        state.fryer(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_fryer(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        request_id: String,
        change: crate::fryer_control::Change,
    ) -> Result<crate::fryer_control::Changed> {
        state
            .change_fryer(home_id, generation, did, baseline, request_id, change)
            .await
    }
    #[tauri::command]
    async fn ceiling_fan(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::ceiling_fan::Report> {
        state.ceiling_fan(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_ceiling_fan(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: crate::ceiling_fan::Change,
    ) -> Result<crate::ceiling_fan::Changed> {
        state
            .change_ceiling_fan(home_id, generation, did, baseline, change)
            .await
    }
    #[tauri::command]
    async fn outlet_energy(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        selection: EnergySelection,
    ) -> Result<EnergyReport> {
        state
            .outlet_energy(home_id, generation, did, selection)
            .await
    }
    #[tauri::command]
    async fn device_preview(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<PanelPreview> {
        state.device_preview(home_id, generation, did).await
    }
    #[tauri::command]
    async fn outlet_timers(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<TimerReport> {
        state.outlet_timers(home_id, generation, did).await
    }
    #[tauri::command]
    async fn change_outlet_timer(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: TimerChange,
    ) -> Result<TimerChangeResult> {
        state
            .change_outlet_timer(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn change_outlet_countdown(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        change: CountdownChange,
    ) -> Result<CountdownChangeResult> {
        state
            .change_outlet_countdown(home_id, generation, did, change)
            .await
    }
    #[tauri::command]
    async fn confirm_property(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        piid: u32,
        value: serde_json::Value,
    ) -> Result<ControlResult> {
        state
            .confirm_property(home_id, generation, did, siid, piid, value)
            .await
    }
    #[tauri::command]
    async fn set_property(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        piid: u32,
        value: Value,
    ) -> Result<ControlResult> {
        state
            .set_property(home_id, generation, did, siid, piid, value)
            .await
    }
    #[tauri::command]
    async fn ir_remote(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::ir_remote::Report> {
        state.ir_remote(home_id, generation, did).await
    }
    #[tauri::command]
    async fn send_ir_key(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        name: String,
        nonce: String,
    ) -> Result<String> {
        state
            .send_ir_key(home_id, generation, did, baseline, name, nonce)
            .await
    }
    #[tauri::command]
    async fn run_action(
        state: tauri::State<'_, AppState>,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        aiid: u32,
        inputs: Vec<Value>,
    ) -> Result<ControlResult> {
        state
            .run_action(home_id, generation, did, siid, aiid, inputs)
            .await
    }
    pub fn run() {
        let context = tauri::generate_context!();
        // Explicit opt-in inspection of this app's real WebView for integration
        // verification. Release builds never enable a debugging endpoint.
        #[cfg(all(feature = "ui-inspect", debug_assertions))]
        let (context, inspect_window) = {
            let mut context = context;
            let window = context.config_mut().app.windows.remove(0);
            (context, window)
        };
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.label() != "main" {
                        return;
                    }
                    static CLOSING: std::sync::atomic::AtomicBool =
                        std::sync::atomic::AtomicBool::new(false);
                    api.prevent_close();
                    if CLOSING.swap(true, std::sync::atomic::Ordering::AcqRel) {
                        return;
                    }
                    let _ = window.hide();
                    let window = window.clone();
                    tauri::async_runtime::spawn(async move {
                        window.state::<AppState>().finish_camera_sessions().await;
                        let _ = window.destroy();
                    });
                } else if matches!(event, tauri::WindowEvent::Destroyed) {
                    window.state::<AppState>().stop_camera_sessions();
                }
            })
            .manage(AppState::new().expect("初始化客户端失败"))
            .setup(move |app| {
                tauri::async_runtime::spawn_blocking(|| {
                    if let Err(error) = crate::media_storage::initialize() {
                        eprintln!("{}", error.message);
                    }
                });
                #[cfg(all(feature = "ui-inspect", debug_assertions))]
                {
                    // Builder paths are absolute; an independent folder avoids
                    // WebView2 options conflicting with an already running app.
                    tauri::WebviewWindowBuilder::from_config(app, &inspect_window)?
                        .data_directory(
                            std::env::temp_dir()
                                .join(format!("mijia-desktop-ui-inspect-{}", std::process::id())),
                        )
                        .additional_browser_args(
                            "--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1",
                        )
                        .build()?;
                }
                if let (Some(window), Some(icon)) =
                    (app.get_webview_window("main"), app.default_window_icon())
                {
                    window.set_icon(icon.clone())?;
                }
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                media_storage,
                choose_media_storage,
                reset_media_storage,
                open_media_storage,
                monitor_window,
                monitor_detail_open,
                monitor_detail_command,
                monitor_detail_microphone,
                monitor_detail_close,
                create_monitor,
                read_monitor,
                retry_monitor,
                stop_monitor,
                monitor_command,
                monitor_screenshot,
                start_camera,
                camera_screenshot,
                camera_media_folder,
                camera_features,
                camera_power,
                camera_auxiliary,
                change_camera_auxiliary,
                change_camera_power,
                camera_care,
                camera_care_thumbnail,
                camera_care_video,
                camera_cloud_save,
                vacuum,
                scale_history,
                change_scale,
                change_vacuum,
                doorbell_cloud,
                camera_command,
                camera_microphone,
                read_camera,
                stop_camera,
                ir_remote,
                send_ir_key,
                washer_program_preview,
                start_washer_program,
                confirm_washer_program,
                session,
                account_profile,
                home_preferences,
                change_home_preferences,
                start_login,
                poll_login,
                cancel_login,
                logout,
                list_homes,
                select_home,
                refresh_devices,
                home_cards,
                router_overview,
                router_daily,
                router_scene,
                router_scene_history,
                router_scene_detail,
                start_router_scene,
                stop_router_scene,
                scan_router_daily,
                optimize_router_daily,
                router_wifi,
                router_password,
                router_client_name,
                router_classification,
                router_family,
                change_router_family,
                confirm_router_family,
                router_url,
                change_router_url,
                confirm_router_url,
                router_qos,
                router_access,
                router_block_records,
                change_router_access,
                confirm_router_access,
                router_whitelist_ready,
                finish_router_whitelist,
                change_router_qos,
                confirm_router_qos,
                change_router_classification,
                confirm_router_classification,
                confirm_router_client_name,
                router_internet,
                router_network,
                change_router_network,
                confirm_router_network,
                acknowledge_router_network,
                change_router_internet,
                confirm_router_internet,
                router_advanced,
                change_router_advanced,
                confirm_router_advanced,
                respond_router_dfs,
                change_router_wifi,
                confirm_router_wifi,
                router_indicator,
                change_router_indicator,
                confirm_router_indicator,
                change_home_card,
                confirm_home_card,
                device_panel,
                device_events,
                device_ui_resources,
                washer_config,
                washer_records,
                washer_record_detail,
                light_modes,
                light_settings,
                change_light_settings,
                confirm_light_settings,
                light_favorites,
                change_light_favorite,
                confirm_light_favorite,
                device_preview,
                read_properties,
                save_purifier_cups,
                purifier_dnd,
                purifier_options,
                airer_lift,
                change_fridge,
                change_dispenser,
                dispenser_sterilization,
                dispenser_selfcheck_records,
                dispenser_selfcheck,
                confirm_dispenser_selfcheck,
                dispenser_reminders,
                change_dispenser_reminder,
                dispenser_dnd,
                change_dispenser_dnd,
                reset_fridge,
                save_airer_night,
                change_purifier_push,
                change_purifier_dnd,
                sensor_history,
                purifier_records,
                dispenser_records,
                dispenser_statistics,
                purifier_statistics,
                history_detail,
                outlet_energy,
                speaker_player,
                change_speaker,
                bath_heater,
                change_bath_heater,
                fryer,
                change_fryer,
                ceiling_fan,
                change_ceiling_fan,
                outlet_timers,
                change_outlet_timer,
                change_outlet_countdown,
                set_property,
                confirm_property,
                run_action
            ])
            .run(context)
            .expect("运行客户端失败");
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
