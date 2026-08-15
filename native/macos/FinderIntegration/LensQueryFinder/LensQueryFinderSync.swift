import Cocoa
import FinderSync

@objc(LensQueryFinderSync)
final class LensQueryFinderSync: FIFinderSync {
    private let controller = FIFinderSyncController.default()

    override init() {
        super.init()
        controller.directoryURLs = Set([URL(fileURLWithPath: "/", isDirectory: true)])
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems || menuKind == .contextualMenuForContainer else {
            return nil
        }
        let menu = NSMenu(title: "LensQuery")
        let item = NSMenuItem(
            title: "使用 LensQuery 识别",
            action: #selector(analyzeSelection(_:)),
            keyEquivalent: ""
        )
        item.target = self
        item.image = NSImage(systemSymbolName: "questionmark.circle", accessibilityDescription: "LensQuery")
        menu.addItem(item)
        return menu
    }

    @objc private func analyzeSelection(_ sender: Any?) {
        var urls = controller.selectedItemURLs() ?? []
        if urls.isEmpty, let targetedURL = controller.targetedURL() {
            urls = [targetedURL]
        }
        let paths = urls
            .filter(\.isFileURL)
            .map(\.path)
            .filter { !$0.isEmpty }
        guard !paths.isEmpty else { return }

        var components = URLComponents()
        components.scheme = "lensquery"
        components.host = "analyze"
        components.queryItems = paths.prefix(32).map { URLQueryItem(name: "path", value: $0) }
        guard let url = components.url else { return }
        NSWorkspace.shared.open(url)
    }
}
