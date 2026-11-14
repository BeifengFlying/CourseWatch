import Foundation
import EventKit

// Only the dedicated calendar and entries carrying our ownership URL are modified.
// No Apple account password or iCloud token is read by CourseWatch.
final class CourseWatchCalendarSync {
    private let store = EKEventStore()
    private let defaults = UserDefaults.standard
    private var applying = false
    private var appliedRevision: String?
    private var calendarKey = "CourseWatch.iCloudCalendar"
    private var entriesKey = "CourseWatch.iCloudEntries"

    func authorize(_ completion: @escaping (Bool) -> Void) {
        store.requestFullAccessToEvents { granted, _ in DispatchQueue.main.async { completion(granted) } }
    }

    func apply(_ snapshot: [String: Any], force: Bool = false, completion: (Bool, String) -> Void) {
        guard !applying, let revision = snapshot["revision"] as? String else { return }
        if !force && appliedRevision == revision { return }
        applying = true
        defer { applying = false }
        let enabled = snapshot["enabled"] as? Bool == true
        var mappings = defaults.dictionary(forKey: entriesKey) as? [String: [String: String]] ?? [:]
        if !enabled && mappings.isEmpty {
            appliedRevision = revision
            completion(true, "iCloud 日历同步已关闭")
            return
        }
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            completion(false, "尚未获得日历完整访问权限，请点击“授权并同步日历”")
            return
        }
        store.refreshSourcesIfNecessary()
        do {
            var calendar = defaults.string(forKey: calendarKey).flatMap { store.calendar(withIdentifier: $0) }
            if let existing = calendar, !existing.allowsContentModifications || !isICloud(existing.source) {
                completion(false, "原 iCloud 日历不可写，请在 Mac 的日历中检查账号状态")
                return
            }
            if calendar == nil && !enabled {
                defaults.removeObject(forKey: entriesKey)
                appliedRevision = revision
                completion(true, "原专用日历已移除，同步已关闭")
                return
            }
            if calendar == nil {
                guard let source = store.sources.first(where: isICloud) else {
                    completion(false, "未找到 iCloud 日历账号，请先在 Mac 系统设置中开启 iCloud 日历")
                    return
                }
                let created = EKCalendar(for: .event, eventStore: store)
                created.title = "CourseWatch"
                created.source = source
                try store.saveCalendar(created, commit: true)
                defaults.set(created.calendarIdentifier, forKey: calendarKey)
                calendar = created
            }
            guard let target = calendar else { return }
            let items = snapshot["items"] as? [[String: Any]] ?? []
            let ids = Set(items.compactMap { $0["id"] as? String })
            func ownedEvent(_ id: String) -> EKEvent? {
                let mapping = mappings[id] ?? [:]
                var event = mapping["identifier"].flatMap { store.event(withIdentifier: $0) }
                if event == nil, let external = mapping["external"] {
                    event = store.calendarItems(withExternalIdentifier: external).compactMap { $0 as? EKEvent }.first { $0.calendar.calendarIdentifier == target.calendarIdentifier }
                }
                guard let found = event, found.calendar.calendarIdentifier == target.calendarIdentifier,
                      found.url?.absoluteString == ownerURL(id).absoluteString else { return nil }
                return found
            }
            var nextMappings = mappings
            for id in mappings.keys where !ids.contains(id) {
                if let event = ownedEvent(id) { try store.remove(event, span: .thisEvent, commit: false) }
                nextMappings.removeValue(forKey: id)
            }
            for item in items {
                guard let id = item["id"] as? String, let title = item["title"] as? String,
                      let milliseconds = item["dueAt"] as? Double else { continue }
                let event = ownedEvent(id) ?? EKEvent(eventStore: store)
                event.calendar = target
                event.title = title
                event.notes = item["notes"] as? String
                event.url = ownerURL(id)
                event.startDate = Date(timeIntervalSince1970: milliseconds / 1000)
                event.endDate = event.startDate.addingTimeInterval(60)
                event.alarms = ((item["reminderHours"] as? [Double]) ?? [0]).sorted().map { EKAlarm(relativeOffset: -$0 * 3600) }
                try store.save(event, span: .thisEvent, commit: false)
                // Save the mapping after commit: new events may not yet have identifiers.
                nextMappings[id] = ["identifier": event.eventIdentifier ?? "", "external": event.calendarItemExternalIdentifier ?? ""]
            }
            try store.commit()
            // Resolve newly saved objects by their ownership URL when identifiers were deferred.
            for item in items {
                guard let id = item["id"] as? String, let milliseconds = item["dueAt"] as? Double,
                      nextMappings[id]?["identifier"]?.isEmpty != false else { continue }
                let date = Date(timeIntervalSince1970: milliseconds / 1000)
                let predicate = store.predicateForEvents(withStart: date.addingTimeInterval(-1), end: date.addingTimeInterval(61), calendars: [target])
                if let event = store.events(matching: predicate).first(where: { $0.url == ownerURL(id) }) {
                    nextMappings[id] = ["identifier": event.eventIdentifier ?? "", "external": event.calendarItemExternalIdentifier ?? ""]
                }
            }
            mappings = nextMappings
            defaults.set(mappings, forKey: entriesKey)
            appliedRevision = revision
            completion(true, enabled ? "已写入 iCloud 专用日历（\(items.count) 项）；其他设备的同步时间由 iCloud 决定" : "同步已关闭，已移除 CourseWatch 创建的日程")
        } catch {
            store.reset()
            completion(false, "日历写入未完成，请检查 iCloud 账号、系统日历权限及网络后重试")
        }
    }
    private func isICloud(_ source: EKSource) -> Bool {
        source.sourceType == .calDAV && source.title.lowercased().contains("icloud")
    }
    private func ownerURL(_ id: String) -> URL {
        var url = URLComponents()
        url.scheme = "coursewatch"; url.host = "calendar"
        url.queryItems = [URLQueryItem(name: "entry", value: id)]
        return url.url!
    }
}
