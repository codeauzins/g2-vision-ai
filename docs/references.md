# Official references (checked while building V1)

## OpenAI

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) — Responses API `input_image` + `input_text`, data URLs, `detail`
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create/)
- [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)

This backend uses `client.responses.create` with `instructions` plus a user content list. It does not use deprecated Chat Completions-only vision examples.

## Even Realities / Even Hub

- [Install tooling](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools)
- [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app)
- [Hardware / Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)
- [Display & UI](https://hub.evenrealities.com/docs/build/display)
- [Design guidelines](https://hub.evenrealities.com/docs/build/design-guidelines)
- [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) — events, `setLocalStorage`
- [Contextual menu](https://hub.evenrealities.com/docs/build/contextual-menu)
- [Page lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle)
- [Networking / whitelist](https://hub.evenrealities.com/docs/build/networking)
- [Local Testing](https://hub.evenrealities.com/docs/test/local-testing)
- [Private Testing](https://hub.evenrealities.com/docs/test/private-testing)
- [Packaging & `.ehpk`](https://hub.evenrealities.com/docs/ship/packaging)
- [CLI](https://hub.evenrealities.com/docs/reference/cli)
- [Glossary](https://hub.evenrealities.com/docs/reference/glossary)
- npm: [`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## Render

- [Web services](https://render.com/docs/web-services)
- [Blueprint spec](https://render.com/docs/blueprint-spec)
- [Health checks](https://render.com/docs/health-checks)
- [Free instance spin-down](https://render.com/docs/free)
