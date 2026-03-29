#!/usr/bin/env swift
import Foundation
import ObjectiveC

// --- Parse CLI args ---
guard CommandLine.arguments.count >= 2,
      let jsonData = CommandLine.arguments[1].data(using: .utf8),
      let params = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
      let chatGuid = params["chatGuid"] as? String,
      let question = params["question"] as? String,
      let options = params["options"] as? [String] else {
    print("{\"error\":\"Invalid args\"}"); exit(1)
}

let senderHandle = params["senderHandle"] as? String ?? ""

// --- Load IMCore ---
for path in [
    "/System/Library/PrivateFrameworks/IMCore.framework",
    "/System/Library/PrivateFrameworks/IMFoundation.framework",
    "/System/Library/PrivateFrameworks/IMSharedUtilities.framework"
] {
    Bundle(path: path)?.load()
}

// --- Build Poll Payload ---
var pollOptions: [[String: Any]] = []
for opt in options {
    pollOptions.append([
        "optionIdentifier": UUID().uuidString, "text": opt,
        "attributedText": opt, "creatorHandle": senderHandle, "canBeEdited": true
    ])
}
let pollItem: [String: Any] = [
    "version": 1,
    "item": ["title": question, "creatorHandle": senderHandle, "orderedPollOptions": pollOptions]
]
guard let pjd = try? JSONSerialization.data(withJSONObject: pollItem),
      let pjs = String(data: pjd, encoding: .utf8),
      let enc = pjs.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
    print("{\"error\":\"JSON encode failed\"}"); exit(1)
}

let dataUrl = "data:," + enc
let balloonId = "com.apple.messages.MSMessageExtensionBalloonPlugin:0000000000:com.apple.messages.Polls"

// Build NSKeyedArchiver payload
let url = NSURL(string: dataUrl)!
let payloadDict: NSDictionary = [
    "URL": url, "sessionIdentifier": UUID().uuidString,
    "ldtext": question, "ai": "", "appid": "com.apple.messages.Polls",
    "layoutClass": "MSMessageTemplateLayout", "an": "Polls"
]
let archiver = NSKeyedArchiver(requiringSecureCoding: false)
archiver.outputFormat = .binary
archiver.encode(payloadDict, forKey: NSKeyedArchiveRootObjectKey)
archiver.finishEncoding()
let payload = archiver.encodedData

// --- IMCore setup in RunLoop ---
DispatchQueue.main.async {
    guard let dcCls = NSClassFromString("IMDaemonController"),
          let dc = (dcCls as AnyObject).perform(NSSelectorFromString("sharedInstance"))?.takeUnretainedValue() else {
        print("{\"error\":\"IMDaemonController unavailable\"}"); exit(1)
    }
    let _ = dc.perform(NSSelectorFromString("connectToDaemon"))

    // Request the daemon to load chats
    let _ = dc.perform(NSSelectorFromString("loadAllChats"))

    DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
        guard let regCls = NSClassFromString("IMChatRegistry"),
              let reg = (regCls as AnyObject).perform(NSSelectorFromString("sharedInstance"))?.takeUnretainedValue() else {
            print("{\"error\":\"IMChatRegistry unavailable\"}"); exit(1)
        }

        // Try multiple methods to find the chat
        var chat: AnyObject? = nil

        // Method 1: existingChatWithGUID:
        chat = reg.perform(NSSelectorFromString("existingChatWithGUID:"), with: chatGuid)?.takeUnretainedValue()

        // Method 2: chatForIMHandle with chat identifier
        if chat == nil {
            let chatId = chatGuid
                .replacingOccurrences(of: "iMessage;+;", with: "")
                .replacingOccurrences(of: "iMessage;-;", with: "")
                .replacingOccurrences(of: "SMS;+;", with: "")
                .replacingOccurrences(of: "SMS;-;", with: "")

            // Try existingChatWithChatIdentifier:
            chat = reg.perform(NSSelectorFromString("existingChatWithChatIdentifier:"), with: chatId)?.takeUnretainedValue()
        }

        // Method 3: Get all chats and find by GUID
        if chat == nil {
            if let allChats = reg.perform(NSSelectorFromString("allExistingChats"))?.takeUnretainedValue() as? [AnyObject] {
                for c in allChats {
                    if let guid = c.perform(NSSelectorFromString("guid"))?.takeUnretainedValue() as? String,
                       guid == chatGuid {
                        chat = c
                        break
                    }
                }
                if chat == nil {
                    // Debug: list available chats
                    var guids: [String] = []
                    for c in allChats.prefix(5) {
                        if let g = c.perform(NSSelectorFromString("guid"))?.takeUnretainedValue() as? String {
                            guids.append(g)
                        }
                    }
                    let debugJson = (try? JSONSerialization.data(withJSONObject: guids))
                        .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                    print("{\"error\":\"Chat not in registry\",\"available\":\(debugJson),\"wanted\":\"\(chatGuid)\"}")
                    exit(1)
                }
            }
        }

        guard let foundChat = chat else {
            print("{\"error\":\"Chat not found: \(chatGuid)\"}"); exit(1)
        }

        // --- Discover send methods ---
        let chatClass: AnyClass = type(of: foundChat as AnyObject)
        var methodCount: UInt32 = 0
        var relevant: [String] = []
        if let methods = class_copyMethodList(chatClass, &methodCount) {
            for i in 0..<Int(methodCount) {
                let name = String(cString: sel_getName(method_getName(methods[i])))
                let lower = name.lowercased()
                if lower.contains("send") && (lower.contains("plugin") || lower.contains("balloon") || lower.contains("payload")) {
                    relevant.append(name)
                }
            }
            free(methods)
        }

        // Also check superclass
        if let superClass = class_getSuperclass(chatClass) {
            var superCount: UInt32 = 0
            if let methods = class_copyMethodList(superClass, &superCount) {
                for i in 0..<Int(superCount) {
                    let name = String(cString: sel_getName(method_getName(methods[i])))
                    let lower = name.lowercased()
                    if lower.contains("send") && (lower.contains("plugin") || lower.contains("balloon") || lower.contains("payload")) {
                        relevant.append(name)
                    }
                }
                free(methods)
            }
        }

        // Try known selectors
        let attempts = [
            "sendPluginPayloadData:balloonBundleID:",
            "_sendPluginPayloadData:bundleID:",
            "sendPluginMessage:balloonBundleID:",
            "_sendPluginMessage:balloonBundleID:",
            "sendMessageWithPluginPayload:bundleID:",
        ]

        for sel in attempts {
            let s = NSSelectorFromString(sel)
            if foundChat.responds(to: s) {
                let _ = foundChat.perform(s, with: payload, with: balloonId)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    print("{\"success\":true,\"method\":\"\(sel)\"}")
                    exit(0)
                }
                return
            }
        }

        // Report discovered methods
        let methodsJson = (try? JSONSerialization.data(withJSONObject: relevant))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        print("{\"error\":\"No matching method\",\"discovered_methods\":\(methodsJson)}")
        exit(1)
    }
}

RunLoop.main.run(until: Date(timeIntervalSinceNow: 12))
print("{\"error\":\"Timeout\"}"); exit(1)
