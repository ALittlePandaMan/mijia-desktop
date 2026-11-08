//! One machine-local camera export preference; no account or camera operations.
use crate::{
    camera::save_dialog::Kind,
    error::{AppError, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

static WRITE: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    version: u32,
    #[serde(default)]
    directory: Option<PathBuf>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub directory: String,
    pub screenshot_directory: String,
    pub recording_directory: String,
    pub is_default: bool,
}
fn error(message: &str) -> AppError {
    AppError::new("mediaStorage", message, true)
}
fn preference_file() -> Result<PathBuf> {
    Ok(PathBuf::from(
        crate::platform_paths::local_data_dir().ok_or_else(|| error("无法取得本机设置目录。"))?,
    )
    .join("io.mijiadesktop.client")
    .join("media-storage-v1.json"))
}
fn default_directory() -> Result<PathBuf> {
    crate::platform_paths::media_dir()
}
fn load() -> Result<Document> {
    let path = preference_file()?;
    if !path
        .try_exists()
        .map_err(|_| error("无法读取媒体保存设置。"))?
    {
        return Ok(Document {
            version: 1,
            directory: None,
        });
    }
    if std::fs::metadata(&path)
        .map_err(|_| error("无法读取媒体保存设置。"))?
        .len()
        > 16 * 1024
    {
        return Err(error("媒体保存设置格式无效。"));
    }
    let value: Document =
        serde_json::from_slice(&std::fs::read(path).map_err(|_| error("无法读取媒体保存设置。"))?)
            .map_err(|_| error("媒体保存设置格式无效，请在设置中恢复默认位置。"))?;
    if value.version != 1 {
        return Err(error(
            "此版本不能读取媒体保存设置，请在设置中恢复默认位置。",
        ));
    }
    Ok(value)
}
fn base(document: &Document) -> Result<PathBuf> {
    document
        .directory
        .clone()
        .map(Ok)
        .unwrap_or_else(default_directory)
}
fn view(document: &Document) -> Result<View> {
    let directory = base(document)?;
    Ok(View {
        directory: directory.to_string_lossy().into_owned(),
        screenshot_directory: directory.join("截图").to_string_lossy().into_owned(),
        recording_directory: directory.join("录制").to_string_lossy().into_owned(),
        is_default: document.directory.is_none(),
    })
}
fn prepare(directory: &Path) -> Result<()> {
    if !directory.is_absolute() {
        return Err(error("请选择完整的保存目录。"));
    }
    for child in ["截图", "录制"] {
        std::fs::create_dir_all(directory.join(child))
            .map_err(|_| error("无法创建截图或录制目录，请在设置中选择有写入权限的保存位置。"))?;
    }
    Ok(())
}
pub fn get() -> Result<View> {
    view(&load()?)
}
pub fn initialize() -> Result<()> {
    prepare(&base(&load()?)?)
}
pub fn open() -> Result<()> {
    let directory = base(&load()?)?;
    prepare(&directory)?;
    crate::platform_paths::open_directory(&directory)
}
pub fn set(directory: Option<PathBuf>) -> Result<View> {
    let _guard = WRITE.lock().map_err(|_| error("媒体保存设置正在更新。"))?;
    let document = Document {
        version: 1,
        directory,
    };
    let bytes = serde_json::to_vec(&document).map_err(|_| error("无法保存媒体目录设置。"))?;
    if bytes.len() > 16 * 1024 {
        return Err(error("保存路径过长，请选择较短的目录。"));
    }
    prepare(&base(&document)?)?;
    let destination = preference_file()?;
    std::fs::create_dir_all(destination.parent().unwrap())
        .map_err(|_| error("无法保存媒体目录设置。"))?;
    let temporary = destination.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| error("无法保存媒体目录设置。"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| error("无法保存媒体目录设置。"))?;
        drop(file);
        std::fs::rename(&temporary, &destination).map_err(|_| error("无法保存媒体目录设置。"))?;
        view(&document)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
pub fn destination(kind: Kind) -> Result<PathBuf> {
    let directory = base(&load()?)?;
    prepare(&directory)?;
    let folder = directory.join(match kind {
        Kind::Screenshot => "截图",
        Kind::Recording => "录制",
    });
    for _ in 0..16 {
        let path = folder.join(crate::camera::saved_media::filename("", kind.extension()));
        if !path
            .try_exists()
            .map_err(|_| error("无法访问媒体保存目录。"))?
        {
            return Ok(path);
        }
    }
    Err(error("无法生成新的时间戳文件名，请重试。"))
}

#[cfg(target_os = "windows")]
pub fn choose(owner: isize) -> Result<Option<View>> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static OPEN: AtomicBool = AtomicBool::new(false);
    if OPEN.swap(true, Ordering::AcqRel) {
        return Err(error("请先关闭当前文件夹选择窗口。"));
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            OPEN.store(false, Ordering::Release);
        }
    }
    let _guard = Guard;
    let initial = get().ok().map(|v| v.directory).unwrap_or_default();
    // A dedicated STA thread keeps the native owned dialog away from WebView
    // and from Tokio workers which may already use another COM apartment.
    std::thread::Builder::new()
        .name("media-folder-picker".into())
        .spawn(move || choose_sta(owner, &initial))
        .map_err(|_| error("无法打开文件夹选择窗口。"))?
        .join()
        .map_err(|_| error("文件夹选择窗口意外关闭。"))?
}
#[cfg(target_os = "windows")]
fn choose_sta(owner: isize, initial: &str) -> Result<Option<View>> {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt, ptr};
    use windows_sys::{core::GUID, Win32::System::Com::*};
    // IFileDialog's inherited COM slots, in Windows SDK declaration order.
    // Only called slots have function signatures; unused slots stay pointer-sized.
    #[repr(C)]
    struct DialogVtable {
        unknown: [usize; 3],
        show: unsafe extern "system" fn(*mut c_void, isize) -> i32,
        file_types: [usize; 5],
        set_options: unsafe extern "system" fn(*mut c_void, u32) -> i32,
        get_options: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
        default_folder: usize,
        set_folder: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        folder_and_name: [usize; 4],
        set_title: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
        set_ok: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
        name_label: usize,
        get_result: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    }
    #[repr(C)]
    struct ItemVtable {
        unknown: [usize; 5],
        display_name: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32,
    }
    struct Object(*mut c_void);
    impl Drop for Object {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let table = *(self.0 as *const *const usize);
                    let release: unsafe extern "system" fn(*mut c_void) -> u32 =
                        std::mem::transmute(*table.add(2));
                    release(self.0);
                }
            }
        }
    }
    fn check(hr: i32) -> Result<()> {
        if hr < 0 {
            Err(error("无法打开 Windows 目录选择窗口。"))
        } else {
            Ok(())
        }
    }
    let open_class = GUID::from_u128(0xdc1c5a9c_e88a_4dde_a5a1_60f82a20aef7);
    let open_iid = GUID::from_u128(0xd57c7288_d4ad_4768_be02_9d969532d960);
    let item_iid = GUID::from_u128(0x43826d1e_e718_42ee_bc55_a1e261c37bfe);
    check(unsafe { CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32) })?;
    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let _com = Com;
    let mut raw = ptr::null_mut();
    check(unsafe {
        CoCreateInstance(
            &open_class,
            ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &open_iid,
            &mut raw,
        )
    })?;
    if raw.is_null() {
        return Err(error("目录选择窗口初始化失败。"));
    }
    let dialog = Object(raw);
    let table = unsafe { &**(dialog.0 as *const *const DialogVtable) };
    let mut options = 0;
    check(unsafe { (table.get_options)(dialog.0, &mut options) })?;
    // PICKFOLDERS + FORCEFILESYSTEM + PATHMUSTEXIST + NOCHANGEDIR.
    check(unsafe { (table.set_options)(dialog.0, options | 0x20 | 0x40 | 0x800 | 0x8) })?;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let title = wide("选择截图和录制的保存位置");
    let ok = wide("选择文件夹");
    check(unsafe { (table.set_title)(dialog.0, title.as_ptr()) })?;
    check(unsafe { (table.set_ok)(dialog.0, ok.as_ptr()) })?;
    if !initial.is_empty() {
        let path = wide(initial);
        let mut folder = ptr::null_mut();
        let hr = unsafe {
            windows_sys::Win32::UI::Shell::SHCreateItemFromParsingName(
                path.as_ptr(),
                ptr::null_mut(),
                &item_iid,
                &mut folder,
            )
        };
        let folder = Object(folder);
        if hr >= 0 && !folder.0.is_null() {
            let _ = unsafe { (table.set_folder)(dialog.0, folder.0) };
        }
    }
    let hr = unsafe { (table.show)(dialog.0, owner) };
    if hr == 0x800704c7u32 as i32 {
        return Ok(None);
    }
    check(hr)?;
    let mut selected = ptr::null_mut();
    check(unsafe { (table.get_result)(dialog.0, &mut selected) })?;
    let selected = Object(selected);
    if selected.0.is_null() {
        return Err(error("未取得所选目录。"));
    }
    let item = unsafe { &**(selected.0 as *const *const ItemVtable) };
    let mut path = ptr::null_mut();
    check(unsafe { (item.display_name)(selected.0, 0x80058000, &mut path) })?;
    if path.is_null() {
        return Err(error("请选择实际的文件系统目录。"));
    }
    struct Memory(*mut u16);
    impl Drop for Memory {
        fn drop(&mut self) {
            unsafe {
                CoTaskMemFree(self.0.cast());
            }
        }
    }
    let path = Memory(path);
    let mut length = 0;
    while length < 32768 && unsafe { *path.0.add(length) } != 0 {
        length += 1;
    }
    if length == 32768 {
        return Err(error("保存路径过长。"));
    }
    let value = unsafe { std::slice::from_raw_parts(path.0, length) };
    set(Some(PathBuf::from(std::ffi::OsString::from_wide(value)))).map(Some)
}
#[cfg(not(target_os = "windows"))]
pub fn choose(_owner: isize) -> Result<Option<View>> {
    Err(error("当前平台不支持 Windows 文件夹选择窗口。"))
}

#[cfg(all(feature = "desktop", not(target_os = "windows")))]
pub fn choose_window(window: &tauri::WebviewWindow) -> Result<Option<View>> {
    use tauri_plugin_dialog::DialogExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    static OPEN: AtomicBool = AtomicBool::new(false);
    if OPEN.swap(true, Ordering::AcqRel) { return Err(error("请先关闭当前文件夹选择窗口。")); }
    struct Guard;
    impl Drop for Guard { fn drop(&mut self) { OPEN.store(false, Ordering::Release); } }
    let _guard = Guard;
    let initial = get()?.directory;
    let path = window.dialog().file().set_parent(window)
        .set_title("选择截图和录制的保存位置").set_directory(initial).blocking_pick_folder();
    path.map(|path| path.into_path().map_err(|_| error("请选择本机文件夹。"))
        .and_then(|path| set(Some(path)))).transpose()
}
