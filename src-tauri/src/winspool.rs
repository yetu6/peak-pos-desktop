//! The Windows print spooler, called straight from the till (2026-11-05).
//! Until 0.2.1 every ticket started PowerShell twice: once to list this
//! computer's printers, and once to compile a small C# program that called
//! these same winspool functions. At Casanova that was 3.7 to 5 s between Yetu
//! handing the till a ticket and the printer taking it. Called from here the
//! spooler takes the bytes in milliseconds, in RAW mode as before, so the
//! printer's own commands (large type, the cut, the cash drawer) reach it
//! untouched.

use std::ffi::c_void;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_HANDLE, PRINTER_INFO_4W,
};

/// Why the spooler didn't take a job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendError {
    /// This computer has no printer by that name.
    NotFound,
    /// The printer wouldn't start the job.
    Refused,
    /// The spooler took only part of the bytes.
    Partial,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A NUL-ended wide string the spooler wrote, as text.
///
/// # Safety
/// `ptr` is null or points at a NUL-ended UTF-16 string that outlives the call.
unsafe fn from_wide(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}

/// This computer's printers and the shared ones it is connected to, by name:
/// the list Get-Printer gave.
pub fn printer_names() -> Vec<String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    // Ask how much room the list needs, then read it. A printer added between
    // the two makes the room too small, so ask again, a few times at most.
    for _ in 0..3 {
        let (mut needed, mut count) = (0u32, 0u32);
        // SAFETY: a size query; the spooler writes only the two counts.
        unsafe { EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut count) };
        if needed == 0 {
            return Vec::new();
        }
        // u64s, so the PRINTER_INFO_4W records the spooler lays out are aligned.
        let mut room = vec![0u64; (needed as usize).div_ceil(8)];
        let size = (room.len() * 8) as u32;
        // SAFETY: `room` holds `size` writable bytes for the spooler.
        let ok = unsafe { EnumPrintersW(flags, null(), 4, room.as_mut_ptr().cast(), size, &mut needed, &mut count) };
        if ok != 0 {
            // SAFETY: on success the spooler wrote `count` records at the start
            // of `room`, and the names they point to inside it; both live here.
            let records = unsafe { std::slice::from_raw_parts(room.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize) };
            return records
                .iter()
                .map(|record| unsafe { from_wide(record.pPrinterName) })
                .filter(|name| !name.is_empty())
                .collect();
        }
    }
    Vec::new()
}

/// Sends the bytes to the named printer through the spooler in RAW mode,
/// whole. Ok means the spooler has the job, as it meant with PowerShell.
pub fn send_raw(printer: &str, document: &str, bytes: &[u8]) -> Result<(), SendError> {
    let name = wide(printer);
    let mut handle = PRINTER_HANDLE { Value: null_mut() };
    // SAFETY: `name` is NUL-ended and outlives the call; no defaults asked for.
    if unsafe { OpenPrinterW(name.as_ptr(), &mut handle, null()) } == 0 {
        return Err(SendError::NotFound);
    }
    // SAFETY: `handle` was opened above and is closed once, after the job.
    let sent = unsafe { send_to_open(handle, document, bytes) };
    unsafe { ClosePrinter(handle) };
    sent
}

/// # Safety
/// `handle` is an open printer handle.
unsafe fn send_to_open(handle: PRINTER_HANDLE, document: &str, bytes: &[u8]) -> Result<(), SendError> {
    let mut doc_name = wide(document);
    let mut datatype = wide("RAW");
    let info = DOC_INFO_1W {
        pDocName: doc_name.as_mut_ptr(),
        pOutputFile: null_mut(),
        pDatatype: datatype.as_mut_ptr(),
    };
    if StartDocPrinterW(handle, 1, &info) == 0 {
        return Err(SendError::Refused);
    }
    // A RAW job needs no page; it is marked as the C# program did.
    StartPagePrinter(handle);
    let written = write_all(handle, bytes);
    EndPagePrinter(handle);
    EndDocPrinter(handle);
    written
}

/// # Safety
/// `handle` is an open printer handle with a document started.
unsafe fn write_all(handle: PRINTER_HANDLE, bytes: &[u8]) -> Result<(), SendError> {
    let mut rest = bytes;
    while !rest.is_empty() {
        let chunk = rest.len().min(u32::MAX as usize) as u32;
        let mut written = 0u32;
        if WritePrinter(handle, rest.as_ptr().cast::<c_void>(), chunk, &mut written) == 0 || written == 0 {
            return Err(SendError::Partial);
        }
        rest = &rest[written as usize..];
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_printer_list_comes_whole_from_the_spooler() {
        // A test computer may have no printer at all; a name that comes back
        // is a whole name, never empty or cut at a NUL.
        for name in printer_names() {
            assert!(!name.is_empty() && !name.contains('\0'), "{name:?}");
        }
    }

    #[test]
    fn a_printer_this_computer_does_not_have_is_not_found() {
        assert_eq!(
            send_raw("Yetu has no printer by this name 5f0c", "Yetu ticket", b"x"),
            Err(SendError::NotFound)
        );
    }
}
