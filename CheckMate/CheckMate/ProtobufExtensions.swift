import SwiftProtobuf

extension SwiftProtobuf.Message {
    init(_ build: (inout Self) -> Void) {
        self.init()
        build(&self)
    }
}
