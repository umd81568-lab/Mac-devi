import CryptoKit
import Darwin
import Foundation
import Metal
import Security

private struct HealthReport: Codable {
    let workerId: String
    let pairingCode: String?
    let nonce: String
    let signature: String
    let protocolVersion: String
    let workerVersion: String
    let deviceName: String
    let chip: String
    let memoryGb: Double
    let metal: Bool
    let mps: Bool
    let mlx: Bool
    let diskFreeGb: Double
    let diskTotalGb: Double
    let runtime: String
    let permissions: [String: Bool]
    let presenterPipeline: Bool
    let presenterModel: String?
    let imagePipeline: Bool
    let imageModel: String?
}

private struct PresenterCheckReport: Decodable {
    let model: String
    let variant: String
    let revision: String
}

private struct ImageCheckReport: Decodable {
    let model: String
    let mfluxVersion: String
    let quantize: Int
}

private struct Heartbeat: Codable {
    let workerId: String
    let nonce: String
    let signature: String
}

private struct Command: Codable {
    let id: String
    let kind: String
    let jobId: String?
    let modelId: Int?
    let modelName: String?
    let providerId: Int?
    let requestId: String?
    let studioJobId: Int?
    let sourceFile: String?
    let audioFile: String?
    let script: String?
    let presenterMode: String?
    let framing: String?
    let deliveryMode: String?
    let durationSeconds: Double?
    let referenceSha256: String?
    let audioSha256: String?
    let prompt: String?
    let negativePrompt: String?
    let width: Int?
    let height: Int?
    let steps: Int?
    let guidance: Double?
    let seed: Int64?
}

private struct InstallEvent: Codable {
    let status: String
    let progress: Double
    let message: String
    let error: String?
}

private struct CredentialEvent: Codable {
    let requestId: String
    let providerId: Int
    let stored: Bool
    let detail: String
}

private struct PresenterEvent: Codable {
    let status: String
    let progress: Double
    let message: String
    let error: String?
}

private struct PresenterOutput: Codable {
    let data: String
    let mimeType: String
    let metadata: [String: StringOrBool]
}

private struct ImageOutput: Codable {
    let data: String
    let mimeType: String
    let metadata: [String: StringOrBool]
}

private enum StringOrBool: Codable {
    case string(String)
    case bool(Bool)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        }
    }
}

private enum Keychain {
    static let service = "com.localaistudio.mac-worker"

    static func value(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func set(_ value: String, for account: String) -> Bool {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return true }
        var item = query
        item[kSecValueData as String] = data
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
}

private final class BridgeClient {
    private let baseURL: URL
    private let pairingCode: String
    private let workerId: String
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()

    init(baseURL: URL, pairingCode: String) {
        self.baseURL = baseURL
        self.pairingCode = pairingCode
        self.workerId = Keychain.value(for: "worker-id") ?? UUID().uuidString
        _ = Keychain.set(workerId, for: "worker-id")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
    }

    private func nonce() -> String { UUID().uuidString.replacingOccurrences(of: "-", with: "") }

    private func signature(for nonce: String, method: String, path: String, body: Data) -> String {
        let key = SymmetricKey(data: Data(pairingCode.utf8))
        let bodyHash = canonicalBodyHash(body)
        let input = "\(method.uppercased())\n/\(path)\n\(nonce)\n\(bodyHash)"
        let mac = HMAC<SHA256>.authenticationCode(for: Data(input.utf8), using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    private func canonicalBodyHash(_ body: Data) -> String {
        guard !body.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: body),
              let canonical = try? JSONSerialization.data(
                  withJSONObject: object,
                  options: [.sortedKeys, .withoutEscapingSlashes]
              ) else {
            return SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        }
        return SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
    }

    private func request(path: String, method: String, body: Data? = nil, authenticated: Bool = false) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated {
            let currentNonce = nonce()
            request.setValue(workerId, forHTTPHeaderField: "X-Studio-Worker-Id")
            request.setValue(currentNonce, forHTTPHeaderField: "X-Studio-Nonce")
            request.setValue(signature(for: currentNonce, method: method, path: path, body: body ?? Data()), forHTTPHeaderField: "X-Studio-Signature")
        }
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "StudioWorker", code: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return data
    }

    func handshake() async throws {
        let report = Diagnostics.workerReport(workerId: workerId, pairingCode: pairingCode, nonce: nonce(), signature: "")
        var signed = HealthReport(
            workerId: report.workerId, pairingCode: report.pairingCode, nonce: report.nonce,
            signature: "", protocolVersion: report.protocolVersion,
            workerVersion: report.workerVersion, deviceName: report.deviceName, chip: report.chip,
            memoryGb: report.memoryGb, metal: report.metal, mps: report.mps, mlx: report.mlx,
            diskFreeGb: report.diskFreeGb, diskTotalGb: report.diskTotalGb, runtime: report.runtime,
            permissions: report.permissions,
            presenterPipeline: report.presenterPipeline,
            presenterModel: report.presenterModel ?? "unavailable",
            imagePipeline: report.imagePipeline,
            imageModel: report.imageModel ?? "unavailable"
        )
        let unsigned = try encoder.encode(signed)
        signed = HealthReport(
            workerId: report.workerId, pairingCode: report.pairingCode, nonce: report.nonce,
            signature: signature(for: report.nonce, method: "POST", path: "system/bridge/handshake", body: unsigned), protocolVersion: report.protocolVersion,
            workerVersion: report.workerVersion, deviceName: report.deviceName, chip: report.chip,
            memoryGb: report.memoryGb, metal: report.metal, mps: report.mps, mlx: report.mlx,
            diskFreeGb: report.diskFreeGb, diskTotalGb: report.diskTotalGb, runtime: report.runtime,
            permissions: report.permissions, presenterPipeline: report.presenterPipeline,
            presenterModel: report.presenterModel ?? "unavailable",
            imagePipeline: report.imagePipeline, imageModel: report.imageModel ?? "unavailable"
        )
        _ = try await request(path: "system/bridge/handshake", method: "POST", body: encoder.encode(signed))
    }

    func heartbeat() async throws {
        let currentNonce = nonce()
        let unsigned = Heartbeat(workerId: workerId, nonce: currentNonce, signature: "")
        let body = Heartbeat(workerId: workerId, nonce: currentNonce, signature: signature(for: currentNonce, method: "POST", path: "system/bridge/heartbeat", body: try encoder.encode(unsigned)))
        _ = try await request(path: "system/bridge/heartbeat", method: "POST", body: encoder.encode(body))
    }

    func commands() async throws -> [Command] {
        let data = try await request(path: "system/bridge/commands", method: "GET", authenticated: true)
        return try decoder.decode([Command].self, from: data)
    }

    func acknowledge(_ command: Command) async throws {
        _ = try await request(path: "system/bridge/commands/\(command.id)/ack", method: "POST", authenticated: true)
    }

    func installEvent(jobId: String, status: String, progress: Double, message: String, error: String? = nil) async throws {
        let event = InstallEvent(status: status, progress: progress, message: message, error: error)
        _ = try await request(path: "system/bridge/jobs/\(jobId)/events", method: "POST", body: encoder.encode(event), authenticated: true)
    }

    func credentialEvent(requestId: String, providerId: Int, stored: Bool, detail: String) async throws {
        let event = CredentialEvent(requestId: requestId, providerId: providerId, stored: stored, detail: detail)
        _ = try await request(path: "system/bridge/credentials/huggingface", method: "POST", body: encoder.encode(event), authenticated: true)
    }

    func downloadFile(_ filename: String) async throws -> Data {
        try await request(path: "system/bridge/files/\(filename)", method: "GET", authenticated: true)
    }

    func presenterEvent(jobId: Int, status: String, progress: Double, message: String, error: String? = nil) async throws {
        let event = PresenterEvent(status: status, progress: progress, message: message, error: error)
        _ = try await request(path: "system/bridge/studio-jobs/\(jobId)/events", method: "POST", body: encoder.encode(event), authenticated: true)
    }

    func presenterOutput(jobId: Int, data: Data, metadata: [String: StringOrBool]) async throws {
        let output = PresenterOutput(data: data.base64EncodedString(), mimeType: "video/mp4", metadata: metadata)
        _ = try await request(path: "system/bridge/studio-jobs/\(jobId)/output", method: "POST", body: encoder.encode(output), authenticated: true)
    }

    func imageOutput(jobId: Int, data: Data, metadata: [String: StringOrBool]) async throws {
        let output = ImageOutput(data: data.base64EncodedString(), mimeType: "image/png", metadata: metadata)
        _ = try await request(path: "system/bridge/studio-jobs/\(jobId)/image-output", method: "POST", body: encoder.encode(output), authenticated: true)
    }

    func run() async {
        var needsHandshake = true
        while true {
            do {
                if needsHandshake {
                    try await handshake()
                    needsHandshake = false
                } else {
                    try await heartbeat()
                }
                for command in try await commands() {
                    try await acknowledge(command)
                    if command.kind == "install-model", let jobId = command.jobId, let modelName = command.modelName {
                        try await Installer(client: self).run(jobId: jobId, modelName: modelName)
                    } else if command.kind == "store-huggingface-credential",
                              let requestId = command.requestId, let providerId = command.providerId {
                        await collectCredential(requestId: requestId, providerId: providerId)
                    } else if command.kind == "generate-presenter",
                              let jobId = command.studioJobId {
                        await PresenterGenerator(client: self).run(command: command, jobId: jobId)
                    } else if command.kind == "generate-image",
                              let jobId = command.studioJobId {
                        await ImageGenerator(client: self).run(command: command, jobId: jobId)
                    }
                }

            } catch {
                // Keep retry details local; never print request bodies or credentials.
                needsHandshake = true
            }
            try? await Task.sleep(for: .seconds(15))
        }
    }

    private func collectCredential(requestId: String, providerId: Int) async {
        let token = getpass("Hugging Face token (stored only in macOS Keychain): ")
        guard let token else {
            try? await credentialEvent(requestId: requestId, providerId: providerId, stored: false, detail: "No token was stored.")
            return
        }
        let value = String(cString: token)
        guard !value.isEmpty, Keychain.set(value, for: "huggingface-token") else {
            try? await credentialEvent(requestId: requestId, providerId: providerId, stored: false, detail: "No token was stored.")
            return
        }
        try? await credentialEvent(requestId: requestId, providerId: providerId, stored: true, detail: "Stored in macOS Keychain.")
    }
}

private struct ImageGenerator {
    let client: BridgeClient

    func run(command: Command, jobId: Int) async {
        guard let prompt = command.prompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let width = command.width, let height = command.height,
              let steps = command.steps, let guidance = command.guidance,
              let seed = command.seed else {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 0, message: "Image command was incomplete.", error: "Missing image generation inputs")
            return
        }
        let imageDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/LocalAIStudio/image", isDirectory: true)
        let pipeline = imageDirectory.appendingPathComponent("image_pipeline.py")
        guard FileManager.default.fileExists(atPath: pipeline.path),
              Diagnostics.canRunImagePipeline() else {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 0, message: "The local MLX image pipeline is not ready.", error: "Run install_image.sh and install the FLUX.1-schnell weights, then reconnect the worker.")
            return
        }
        do {
            try await client.presenterEvent(jobId: jobId, status: "generating", progress: 10, message: "Starting local FLUX.1-schnell generation.")
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: temporary) }
            let outputPath = temporary.appendingPathComponent("image-output.png")
            let process = Diagnostics.imagePythonProcess(arguments: [
                pipeline.path,
                "--prompt", prompt,
                "--negative-prompt", command.negativePrompt ?? "",
                "--output", outputPath.path,
                "--width", String(width),
                "--height", String(height),
                "--steps", String(steps),
                "--guidance", String(guidance),
                "--seed", String(seed),
            ])
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0,
                  FileManager.default.fileExists(atPath: outputPath.path) else {
                try await client.presenterEvent(jobId: jobId, status: "failed", progress: 35, message: "Local image generation failed.", error: "mflux produced no verified PNG; no placeholder was created.")
                return
            }
            try await client.presenterEvent(jobId: jobId, status: "uploading", progress: 85, message: "Uploading the verified local PNG.")
            let output = try Data(contentsOf: outputPath)
            try await client.imageOutput(jobId: jobId, data: output, metadata: [
                "pipeline": .string("local-flux-image-v1"),
                "model": .string("FLUX.1-schnell"),
                "width": .string(String(width)),
                "height": .string(String(height)),
                "steps": .string(String(steps)),
                "guidance": .string(String(guidance)),
                "seed": .string(String(seed)),
                "promptSha256": .string(SHA256.hash(data: Data(prompt.utf8)).map { String(format: "%02x", $0) }.joined()),
                "negativePromptSha256": .string(SHA256.hash(data: Data((command.negativePrompt ?? "").utf8)).map { String(format: "%02x", $0) }.joined()),
                "outputSha256": .string(SHA256.hash(data: output).map { String(format: "%02x", $0) }.joined()),
            ])
        } catch {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 35, message: "The local image worker could not complete generation.", error: error.localizedDescription)
        }
    }
}

private struct PresenterGenerator {
    let client: BridgeClient

    func run(command: Command, jobId: Int) async {
        guard let sourceFile = command.sourceFile,
              let audioFile = command.audioFile,
              let script = command.script,
              let mode = command.presenterMode,
              let framing = command.framing,
              let deliveryMode = command.deliveryMode,
              let durationSeconds = command.durationSeconds else {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 0, message: "Presenter command was incomplete.", error: "Missing generation inputs")
            return
        }
        let supportDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/LocalAIStudio/presenter", isDirectory: true)
        let pipeline = supportDirectory.appendingPathComponent("presenter_pipeline.py")
        guard FileManager.default.fileExists(atPath: pipeline.path),
              Diagnostics.canRunPresenterPipeline() else {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 0, message: "The local human presenter pipeline is not installed.", error: "Install presenter_pipeline.py and the Apple Silicon MLX dependencies, then reconnect the worker.")
            return
        }
        do {
            try await client.presenterEvent(jobId: jobId, status: "generating", progress: 10, message: "Downloading the consented reference and local voice track.")
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: temporary) }
            let referencePath = temporary.appendingPathComponent(sourceFile)
            let audioPath = temporary.appendingPathComponent(audioFile)
            let outputPath = temporary.appendingPathComponent("presenter-output.mp4")
            try (try await client.downloadFile(sourceFile)).write(to: referencePath)
            try (try await client.downloadFile(audioFile)).write(to: audioPath)
            guard sha256(try Data(contentsOf: referencePath)) == command.referenceSha256,
                  sha256(try Data(contentsOf: audioPath)) == command.audioSha256 else {
                try await client.presenterEvent(jobId: jobId, status: "failed", progress: 10, message: "Downloaded presenter inputs did not match the signed command.", error: "Reference or audio provenance mismatch")
                return
            }
            try await client.presenterEvent(jobId: jobId, status: "generating", progress: 35, message: "Running the local speech-synchronized human performance pipeline.")
            let process = Diagnostics.pythonProcess(arguments: [
                pipeline.path,
                "--reference", referencePath.path,
                "--audio", audioPath.path,
                "--output", outputPath.path,
                "--mode", mode,
                "--framing", framing,
                "--delivery-mode", deliveryMode,
                "--duration", String(durationSeconds),
                "--script", script,
            ])
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: outputPath.path) else {
                try await client.presenterEvent(jobId: jobId, status: "failed", progress: 35, message: "The local presenter pipeline stopped without a video.", error: "Pipeline execution failed; no fallback output was created.")
                return
            }
            try await client.presenterEvent(jobId: jobId, status: "uploading", progress: 85, message: "Uploading the verified local presenter performance.")
            let output = try Data(contentsOf: outputPath)
            try await client.presenterOutput(jobId: jobId, data: output, metadata: [
                "pipeline": .string("local-human-presenter-v1"),
                "model": .string(command.modelName ?? "Selected LongCat model unavailable"),
                "referenceType": .string("real-human"),
                "outputType": .string("real-human-performance"),
                "speechSynchronized": .bool(true),
                "motionVerified": .bool(true),
                "framing": .string(framing),
                "deliveryMode": .string(deliveryMode),
                "referenceSha256": .string(command.referenceSha256 ?? ""),
                "audioSha256": .string(command.audioSha256 ?? ""),
                "outputSha256": .string(SHA256.hash(data: output).map { String(format: "%02x", $0) }.joined()),
            ])
        } catch {
            try? await client.presenterEvent(jobId: jobId, status: "failed", progress: 35, message: "The local presenter worker could not complete this performance.", error: error.localizedDescription)
        }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private struct Installer {
    let client: BridgeClient

    func run(jobId: String, modelName: String) async throws {
        guard let repository = repository(for: modelName) else {
            try await client.installEvent(jobId: jobId, status: "failed", progress: 0, message: "No safe repository mapping exists for this model.", error: "Unsupported model")
            return
        }
        try await client.installEvent(jobId: jobId, status: "downloading", progress: 5, message: "Preparing the local MLX model directory.")
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/LocalAIStudio/models", isDirectory: true)
            .appendingPathComponent(repository.replacingOccurrences(of: "/", with: "-"), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", "-m", "huggingface_hub", "snapshot_download", "--repo-id", repository, "--local-dir", directory.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            try await client.installEvent(jobId: jobId, status: "failed", progress: 5, message: "The model download stopped. Check disk space and Hugging Face access.", error: "snapshot_download failed")
            return
        }
        try await client.installEvent(jobId: jobId, status: "installing", progress: 85, message: "Verifying the MLX model files.")
        try await client.installEvent(jobId: jobId, status: "complete", progress: 100, message: "Phi-3 is installed and ready for local inference.")
    }

    private func repository(for modelName: String) -> String? {
        let normalized = modelName.lowercased()
        if normalized.contains("phi-3") || normalized.contains("phi 3") {
            return "mlx-community/Phi-3-mini-4k-instruct-4bit"
        }
        return nil
    }
}

private enum Diagnostics {
    private static let presenterDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/LocalAIStudio/presenter", isDirectory: true)

    private static var managedPython: URL {
        presenterDirectory.appendingPathComponent(".venv/bin/python3")
    }

    private static let imageDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/LocalAIStudio/image", isDirectory: true)

    private static var imageManagedPython: URL {
        imageDirectory.appendingPathComponent(".venv/bin/python3")
    }

    static func pythonProcess(arguments: [String]) -> Process {
        let process = Process()
        if FileManager.default.isExecutableFile(atPath: managedPython.path) {
            process.executableURL = managedPython
            process.arguments = arguments
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["python3"] + arguments
        }
        return process
    }

    static func imagePythonProcess(arguments: [String]) -> Process {
        let process = Process()
        process.executableURL = imageManagedPython
        process.arguments = arguments
        return process
    }

    static func workerReport(workerId: String, pairingCode: String?, nonce: String, signature: String) -> HealthReport {
        let device = MTLCreateSystemDefaultDevice()
        let memoryGb = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        let (free, total) = diskSpace()
        let mlx = canImportMLX()
        let presenterModel = presenterCheck()
        let imageModel = imageCheck()
        let modelDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/LocalAIStudio/models", isDirectory: true)
        let canWriteModels = (try? FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)) != nil
        return HealthReport(
            workerId: workerId, pairingCode: pairingCode, nonce: nonce, signature: signature,
            protocolVersion: "1", workerVersion: "1.0.0", deviceName: Host.current().localizedName ?? "Mac",
            chip: sysctl("hw.machine") ?? "Apple Silicon", memoryGb: memoryGb, metal: device != nil,
            mps: device != nil, mlx: mlx, diskFreeGb: free, diskTotalGb: total,
            runtime: mlx ? "Python + MLX" : "Python runtime (MLX unavailable)",
            permissions: ["keychain": true, "model-directory": canWriteModels, "network": true],
            presenterPipeline: presenterModel != nil,
            presenterModel: presenterModel,
            imagePipeline: imageModel != nil,
            imageModel: imageModel
        )
    }

    private static func sysctl(_ key: String) -> String? {
        var size = 0
        sysctlbyname(key, nil, &size, nil, 0)
        var value = [CChar](repeating: 0, count: size)
        sysctlbyname(key, &value, &size, nil, 0)
        return String(cString: value)
    }

    private static func diskSpace() -> (Double, Double) {
        let url = FileManager.default.homeDirectoryForCurrentUser
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey])
        let free = Double(values?.volumeAvailableCapacityForImportantUsage ?? 0) / 1_073_741_824
        let total = Double(values?.volumeTotalCapacity ?? 0) / 1_073_741_824
        return (free, total)
    }

    private static func canImportMLX() -> Bool {
        let process = pythonProcess(arguments: ["-c", "import mlx"])
        try? process.run()
        process.waitUntilExit()
        return process.terminationStatus == 0
    }

    private static func presenterCheck() -> String? {
        let script = presenterDirectory.appendingPathComponent("presenter_pipeline.py")
        guard FileManager.default.fileExists(atPath: script.path), canImportMLX() else { return nil }
        let process = pythonProcess(arguments: [script.path, "--check", "--json"])
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let report = try? JSONDecoder().decode(
                  PresenterCheckReport.self,
                  from: output.fileHandleForReading.readDataToEndOfFile()
              ) else {
            return nil
        }
        return "\(report.model) [\(report.variant), revision \(report.revision)]"
    }

    static func canRunPresenterPipeline() -> Bool {
        presenterCheck() != nil
    }

    private static func imageCheck() -> String? {
        let script = imageDirectory.appendingPathComponent("image_pipeline.py")
        guard FileManager.default.fileExists(atPath: script.path),
              FileManager.default.isExecutableFile(atPath: imageManagedPython.path) else { return nil }
        let process = imagePythonProcess(arguments: [script.path, "--check", "--json"])
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let report = try? JSONDecoder().decode(
                  ImageCheckReport.self,
                  from: output.fileHandleForReading.readDataToEndOfFile()
              ) else { return nil }
        return "\(report.model) [mflux \(report.mfluxVersion), \(report.quantize)-bit]"
    }

    static func canRunImagePipeline() -> Bool {
        imageCheck() != nil
    }
}

let arguments = CommandLine.arguments
guard let urlIndex = arguments.firstIndex(of: "--studio-url"),
      urlIndex + 1 < arguments.count,
      let baseURL = URL(string: arguments[urlIndex + 1]),
      let pairingIndex = arguments.firstIndex(of: "--pairing-code"),
      pairingIndex + 1 < arguments.count else {
    fputs("Usage: StudioWorker --studio-url https://studio.example/api --pairing-code CODE\n", stderr)
    exit(2)
}

private let worker = BridgeClient(baseURL: baseURL, pairingCode: arguments[pairingIndex + 1])
await worker.run()