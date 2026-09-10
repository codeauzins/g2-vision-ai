# G2 Vision AI — implementation tracker

## COMPLETE

- [x] Inspect workspace, tooling, and GitHub auth (`codeauzins`)
- [x] Research Even Hub SDK 0.0.15, 576×288 display, contextual menu, QR + private `.ehpk`
- [x] Research OpenAI Responses API `input_image` + `input_text`
- [x] Backend: health, auth, upload, jobs, latest, TTL `ResultStore`, image optimize, modes, OpenAI Responses
- [x] Even Hub app: waiting / processing / result / error, polling, pagination, contextual menu, mock mode
- [x] Tests (backend + pagination/state), lint, typecheck, build
- [x] Render + local + Shortcut + private-install + pagination + references docs
- [x] README, `.env.example`, `render.yaml`
- [x] Git init, commits, private GitHub remote

## REQUIRES USER / PHYSICAL DEVICE

- [ ] Create an OpenAI API key and set `OPENAI_API_KEY` on Render
- [ ] Generate and set `G2_DEVICE_SECRET` on Render (and in the Shortcut + `VITE_DEVICE_SECRET`)
- [ ] Connect GitHub `codeauzins/g2-vision-ai` to Render and deploy
- [ ] Put the Render URL into `even-app/.env.local` / `app.json` whitelist, then rebuild/pack
- [ ] Sign in at hub.evenrealities.com, enable Developer Mode, QR or private-install Ask AI
- [ ] Create the Apple Shortcut and bind it to the iPhone Action Button
- [ ] Take a physical test photo and confirm the answer on G2
