//! Destinations come from an owned Windows dialog or the native recording directory, never IPC.
use super::{err, Result};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
pub enum Kind {
    Screenshot,
    Recording,
}
impl Kind {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Screenshot => "png",
            Self::Recording => "mp4",
        }
    }
    fn title(self) -> &'static str {
        match self {
            Self::Screenshot => "保存截图",
            Self::Recording => "保存录像",
        }
    }
    fn filter(self) -> &'static str {
        match self {
            Self::Screenshot => "PNG 图片 (*.png)\0*.png\0\0",
            Self::Recording => "MP4 视频 (*.mp4)\0*.mp4\0\0",
        }
    }
    pub fn validate(self, path: &Path) -> Result<()> {
        if !path.is_absolute()
            || !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case(self.extension()))
            || !path.parent().is_some_and(Path::is_dir)
        {
            return Err(err("mediaSavePath", "请选择有效的保存位置和对应文件类型。"));
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn choose(
    owner: isize,
    suggested: &str,
    kind: Kind,
    initial: Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    use std::{
        os::windows::ffi::OsStringExt,
        sync::atomic::{AtomicBool, Ordering},
    };
    use windows_sys::Win32::UI::Controls::Dialogs::*;
    static OPEN: AtomicBool = AtomicBool::new(false);
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            OPEN.store(false, Ordering::Release);
        }
    }
    if OPEN
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(err("mediaSaveDialogBusy", "请先关闭当前保存窗口。"));
    }
    let _guard = Guard;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let title = wide(kind.title());
    let extension = wide(kind.extension());
    let filter: Vec<_> = kind.filter().encode_utf16().collect();
    let initial = initial.map(|p| {
        use std::os::windows::ffi::OsStrExt;
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    });
    let mut file = vec![0u16; 32768];
    let suggested = wide(suggested);
    file[..suggested.len()].copy_from_slice(&suggested);
    let mut dialog = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner as _,
        lpstrTitle: title.as_ptr(),
        lpstrFilter: filter.as_ptr(),
        nFilterIndex: 1,
        lpstrFile: file.as_mut_ptr(),
        nMaxFile: file.len() as u32,
        lpstrDefExt: extension.as_ptr(),
        lpstrInitialDir: initial.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
        Flags: OFN_EXPLORER
            | OFN_ENABLESIZING
            | OFN_OVERWRITEPROMPT
            | OFN_PATHMUSTEXIST
            | OFN_NOCHANGEDIR,
        ..Default::default()
    };
    // All UTF-16 buffers outlive the synchronous native modal call. The owner
    // is the calling Tauri window; no HWND or destination is accepted from JS.
    if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
        return if unsafe { CommDlgExtendedError() } == 0 {
            Ok(None)
        } else {
            Err(err("mediaSaveDialog", "无法打开 Windows 保存窗口。"))
        };
    }
    let end = file.iter().position(|c| *c == 0).unwrap_or(file.len());
    let path = PathBuf::from(std::ffi::OsString::from_wide(&file[..end]));
    kind.validate(&path)?;
    Ok(Some(path))
}

#[cfg(not(target_os = "windows"))]
pub fn choose(
    _owner: isize,
    _suggested: &str,
    _kind: Kind,
    _initial: Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    Err(err("mediaSaveDialog", "当前平台不支持 Windows 保存窗口。"))
}
