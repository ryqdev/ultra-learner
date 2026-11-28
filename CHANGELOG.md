# Changelog

## [0.3.0](https://github.com/ryqdev/ultra-learner/compare/v0.2.0...v0.3.0) (2026-11-28)


### Features

* redesign the interface around a token-driven visual system ([92acf63](https://github.com/ryqdev/ultra-learner/commit/92acf63865f414dc4f5b1726ec2a503a0f6a890d))
* redesign the interface around a token-driven visual system ([471af5f](https://github.com/ryqdev/ultra-learner/commit/471af5fbcdba3c345acbe805d932bfde32eb84e2))
* support single-user self-hosting behind an authenticating gateway ([2477e5e](https://github.com/ryqdev/ultra-learner/commit/2477e5eae9319a78bdc7127260ccecdb954d7dd8))
* support single-user self-hosting behind an authenticating gateway ([6788960](https://github.com/ryqdev/ultra-learner/commit/6788960c65669d2ac7faf08edd9a756976f8634d)), closes [#20](https://github.com/ryqdev/ultra-learner/issues/20)


### Bug Fixes

* carry the dark theme to the root canvas and browser chrome ([7be2c91](https://github.com/ryqdev/ultra-learner/commit/7be2c91c9272cc20ebdd10366289bcebee658f5b))
* sharpen page thumbnails and tidy reader and Library details ([4aa8e9c](https://github.com/ryqdev/ultra-learner/commit/4aa8e9cc5918d2ce93661cb41a5edfc8fdd02b1c))
* start the Pages rail closed where it overlays the page ([9ffa4e1](https://github.com/ryqdev/ultra-learner/commit/9ffa4e124f79401b775db6a37c7fc87780b057e7))

## [0.2.0](https://github.com/ryqdev/ultra-learner/compare/v0.1.0...v0.2.0) (2026-11-26)


### Features

* reopen each session at the page where it was left ([593c733](https://github.com/ryqdev/ultra-learner/commit/593c7334e796a96fc1b20594a35d26de5735d8e8))
* reuse the stored session when the same PDF is opened again ([cdc3845](https://github.com/ryqdev/ultra-learner/commit/cdc38453e6535ec06f5203f68fb7da641e731dc6))


### Bug Fixes

* apply position updates and identical uploads one at a time ([9da2c44](https://github.com/ryqdev/ultra-learner/commit/9da2c44680b9850de4fec4c578bd3da354e755b3))
* harden the local server and repair reader, session, and model-setup defects ([edc3946](https://github.com/ryqdev/ultra-learner/commit/edc3946ad4a6627f40de71a95bbff7c42de4c5f4))
* keep a session listed when its stored page is unusable ([d9eb33d](https://github.com/ryqdev/ultra-learner/commit/d9eb33d97276273ce16f7e86ccc8a9b3d650a07d))
* keep model setups consistent across saves and credential changes ([5154642](https://github.com/ryqdev/ultra-learner/commit/51546429b7509e02b949f68cea1e21dce4d49b94))
* keep the reading position across zoom and upward page turns ([2cc10e7](https://github.com/ryqdev/ultra-learner/commit/2cc10e7f050a3b20e10b1f9bbbc00b943bdc20b0))
* land a page turn on its edge when a redraw replaces it ([536d472](https://github.com/ryqdev/ultra-learner/commit/536d47289e58776a51bdeeaed986a1b6d15c858f))
* reject requests addressed to a foreign host ([73f71f8](https://github.com/ryqdev/ultra-learner/commit/73f71f826ec3a5ba60e5a6116da40d9e933480ca))
* save setups whose model id is longer than a name ([f855de2](https://github.com/ryqdev/ultra-learner/commit/f855de25ba5aa885bf17a9045996fd479f995f47))
* serve in production mode unless development is requested ([0af1c29](https://github.com/ryqdev/ultra-learner/commit/0af1c291029f2e1cb8e88a8ccd84a171b154534f))
* serve static files on Windows ([f274fb5](https://github.com/ryqdev/ultra-learner/commit/f274fb5e6e23bfcdc237495b9d44c0cae82b055d))
* write sessions atomically and stream uploads to disk ([fbf46ff](https://github.com/ryqdev/ultra-learner/commit/fbf46ff17ad482dd66c6de60cd308dbc5767dffa))


### Performance Improvements

* draw page thumbnails only as they near the visible rail ([439e6ed](https://github.com/ryqdev/ultra-learner/commit/439e6ed0fdcae1395b967a1dfa8878de78cf4c6d))

## 0.1.0 (2026-09-17)


### Features

* support npm distribution and bunx startup ([804577d](https://github.com/ryqdev/ultra-learner/commit/804577dd7bd91912add42cf959831d6543ed90fd))
* support npm distribution and bunx startup ([c2bba8c](https://github.com/ryqdev/ultra-learner/commit/c2bba8ca7cd8edd2c376928ef9b9132131bc9ddd))
