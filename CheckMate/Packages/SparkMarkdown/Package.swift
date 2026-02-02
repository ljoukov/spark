// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "SparkMarkdown",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "SparkMarkdown", targets: ["SparkMarkdown"])
    ],
    targets: [
        .target(
            name: "SparkMarkdown",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
