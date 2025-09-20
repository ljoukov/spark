# Naming

- proto messages use the `Proto` suffix
- proto files use `CamelCaseProto.proto` (Proto suffix + `.proto` extension)
- no package declarations
- enums named `NameOfEnumProto`
  - field names are SCREAMING_SNAKE and `_PROTO_`
  - every enum reserves `..._UNDEFINED = 0`

# Layout & Conventions

- start files with `syntax = "proto3";`, then imports sorted alphabetically, then a blank line before the first message
- group top-level API entry points into `ToonApiRequestProto`/`ToonApiResponseProto` style wrappers with `oneof request/response`
- keep shared auth/user agent structs split into their own messages to avoid repetition
- prefer `oneof` for mutually exclusive body variants
- use `repeated` fields for ordered collections and `map<>` for keyed lookups when data is sparse
- reserve field numbers: 1-9 for metadata, 10+ for request/response variants, 100+ for future-proof counters/metrics

# Sample Message

```proto
message ToonApiResponseProto {
  oneof response {
    ToonListStylesResponseProto list_styles = 10;
    ToonCreateResponseProto create = 11;
    ToonDeleteResponseProto delete = 12;
    ToonDeleteAccountResponseProto delete_account = 13;
  }
  // keep at 100 to allow clean numbering of new api messages later
  map<string, google.protobuf.Duration> latencies = 100;
}
```
