//! Native 16637 calendar contract, validated before any cloud request.
use crate::{
    error::{AppError, Result},
    models::{HistoryPeriod, HistorySelection},
};
use chrono::{
    DateTime, Datelike, Days, Local, Months, NaiveDate, NaiveDateTime, TimeZone, Timelike,
};

pub(crate) struct HistoryRange {
    pub start: u64,
    pub end: u64,
    pub reference_time: u64,
}

pub(crate) fn for_selection(selection: &HistorySelection) -> Result<HistoryRange> {
    range(selection, Local::now())
}

fn range<T: TimeZone>(selection: &HistorySelection, now: DateTime<T>) -> Result<HistoryRange> {
    let invalid = || AppError::invalid("请选择最近一年内的有效日期或月份。");
    let date = NaiveDate::parse_from_str(&selection.date, "%Y-%m-%d").map_err(|_| invalid())?;
    if date.format("%Y-%m-%d").to_string() != selection.date {
        return Err(invalid());
    }
    let today = now.date_naive();
    // JS setFullYear rolls 29 Feb to 1 Mar in a non-leap year.
    let minimum = today
        .with_year(today.year() - 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(today.year() - 1, 3, 1).unwrap());
    let first = date.with_day(1).ok_or_else(invalid)?;
    let next_month = first
        .checked_add_months(Months::new(1))
        .ok_or_else(invalid)?;
    let last = next_month.pred_opt().ok_or_else(invalid)?;
    let valid = match selection.period {
        HistoryPeriod::Day => date >= minimum && date <= today,
        HistoryPeriod::Month => last >= minimum && first <= today,
        HistoryPeriod::Year => date.year() == today.year() && date <= today,
    };
    if !valid {
        return Err(invalid());
    }
    let local = |naive: NaiveDateTime| -> Result<u64> {
        now.timezone()
            .from_local_datetime(&naive)
            .earliest()
            .and_then(|time| u64::try_from(time.timestamp()).ok())
            .ok_or_else(invalid)
    };
    let now_secs = u64::try_from(now.timestamp()).map_err(|_| invalid())?;
    let (start, end) = match selection.period {
        HistoryPeriod::Day if date == today => {
            let yesterday = today.checked_sub_days(Days::new(1)).ok_or_else(invalid)?;
            (
                local(
                    yesterday
                        .and_hms_opt(now.hour(), 0, 0)
                        .ok_or_else(invalid)?,
                )?,
                now_secs,
            )
        }
        HistoryPeriod::Day => (
            local(date.and_hms_opt(0, 0, 0).ok_or_else(invalid)?)?,
            local(date.and_hms_opt(23, 59, 59).ok_or_else(invalid)?)?,
        ),
        HistoryPeriod::Month => (
            local(first.and_hms_opt(0, 0, 0).ok_or_else(invalid)?)?,
            local(last.and_hms_opt(23, 59, 59).ok_or_else(invalid)?)?,
        ),
        HistoryPeriod::Year => {
            // Date.setMonth's extra arguments do not zero the current clock.
            let first = today
                .with_day(1)
                .and_then(|date| date.checked_sub_months(Months::new(5)))
                .ok_or_else(invalid)?;
            (
                local(first.and_time(now.time().with_nanosecond(0).ok_or_else(invalid)?))?,
                now_secs,
            )
        }
    };
    Ok(HistoryRange {
        start: start.saturating_sub(1800),
        end: end + 1800,
        reference_time: now_secs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<FixedOffset> {
        FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }
    fn selection(period: HistoryPeriod, date: &str) -> HistorySelection {
        HistorySelection {
            period,
            date: date.into(),
        }
    }
    #[test]
    fn today_and_historical_day_use_the_native_windows_with_margins() {
        let now = at(2026, 10, 26, 20, 12);
        let today = range(&selection(HistoryPeriod::Day, "2026-10-26"), now).unwrap();
        assert_eq!(
            today.start,
            at(2026, 10, 25, 20, 0).timestamp() as u64 - 1800
        );
        assert_eq!(today.end, now.timestamp() as u64 + 1800);
        let yesterday = range(&selection(HistoryPeriod::Day, "2026-10-25"), now).unwrap();
        assert_eq!(
            yesterday.start,
            at(2026, 10, 25, 0, 0).timestamp() as u64 - 1800
        );
        assert_eq!(
            yesterday.end,
            at(2026, 10, 26, 0, 0).timestamp() as u64 - 1 + 1800
        );
    }
    #[test]
    fn leap_month_and_year_are_calendar_based_not_fixed_day_counts() {
        let now = at(2024, 2, 29, 20, 12);
        let month = range(&selection(HistoryPeriod::Month, "2024-02-01"), now).unwrap();
        assert_eq!(
            month.end,
            at(2024, 3, 1, 0, 0).timestamp() as u64 - 1 + 1800
        );
        let year = range(&selection(HistoryPeriod::Year, "2024-02-29"), now).unwrap();
        assert_eq!(year.start, at(2023, 9, 1, 20, 12).timestamp() as u64 - 1800);
    }
    #[test]
    fn arbitrary_future_old_and_malformed_dates_are_rejected_before_network_io() {
        let now = at(2026, 10, 26, 20, 12);
        for date in [
            "2026-10-27",
            "2025-10-25",
            "2026-02-30",
            "2026-1-1",
            "2026-10-26Z",
        ] {
            assert!(
                range(&selection(HistoryPeriod::Day, date), now).is_err(),
                "{date}"
            );
        }
        assert!(range(&selection(HistoryPeriod::Month, "2025-10-01"), now).is_ok());
        assert!(range(&selection(HistoryPeriod::Month, "2025-09-01"), now).is_err());
        assert!(range(&selection(HistoryPeriod::Month, "2026-11-01"), now).is_err());
        assert!(range(&selection(HistoryPeriod::Year, "2025-12-01"), now).is_err());
    }
}
