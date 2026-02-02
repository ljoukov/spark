import SwiftUI

public struct SparkMarkdownView: View {
    private let markdown: String
    private let enableLatex: Bool

    @State private var contentHeight: CGFloat = 0

    public init(_ markdown: String, enableLatex: Bool = true) {
        self.markdown = markdown
        self.enableLatex = enableLatex
    }

    public var body: some View {
        SparkMarkdownRepresentable(
            markdown: markdown,
            enableLatex: enableLatex,
            contentHeight: $contentHeight
        )
        .frame(height: contentHeight)
        .onChange(of: contentHeight) { newValue in
            print("[SparkMarkdown] contentHeight=\(newValue)")
        }
    }
}

private struct SparkMarkdownRepresentable: UIViewRepresentable {
    let markdown: String
    let enableLatex: Bool
    @Binding var contentHeight: CGFloat

    func makeUIView(context: Context) -> SparkMarkdownWKWebView {
        SparkMarkdownWKWebView(enableLatex: enableLatex)
    }

    func updateUIView(_ webView: SparkMarkdownWKWebView, context: Context) {
        Task {
            do {
                let height = try await webView.renderMarkdown(markdown, enableLatex: enableLatex)
                print("[SparkMarkdown] updateUIView height=\(height)")
                contentHeight = height
            } catch {
                print("[SparkMarkdown] updateUIView error=\(error)")
                contentHeight = 0
            }
        }
    }
}

#Preview {
    ScrollView {
        SparkMarkdownView(
            """
            # Markdown Playground

            Here is **bold text**, _italic text_, and `inline code`.

            ## Lists

            - First bullet
            - Second bullet with **emphasis**
            - Third bullet

            1. Ordered item one
            2. Ordered item two

            ## Table

            | Column A | Column B | Column C |
            | --- | --- | --- |
            | Alpha | Beta | Gamma |
            | 1 | 2 | 3 |

            ## Math

            Inline: $E = mc^2$ and $\\frac{a}{b}$.

            Display:

            $$
            \\int_{-\\infty}^{\\infty} e^{-x^2} \\; dx = \\sqrt{\\pi}
            $$

            ## Code

            ```ts
            type User = { id: string; name: string };

            const users: User[] = [
              { id: '1', name: 'Ada' },
              { id: '2', name: 'Linus' }
            ];

            const names = users.map((user) => user.name);
            console.log(names.join(', '));
            ```
            """
        )
        .padding()
    }
}
