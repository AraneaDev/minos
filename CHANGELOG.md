# Changelog

## [0.0.7](https://github.com/AraneaDev/minos/compare/v0.0.6...v0.0.7) (2026-09-16)


### Fixes

* honor forced terminal color ([#10](https://github.com/AraneaDev/minos/issues/10)) ([9091415](https://github.com/AraneaDev/minos/commit/9091415c50b6d65fd491be2bdd12e3f866d98526))
* ignore release configuration changes ([#12](https://github.com/AraneaDev/minos/issues/12)) ([1aa4f31](https://github.com/AraneaDev/minos/commit/1aa4f31db4a03285e3ab3e3488f8feee22774eed))

## [0.0.6](https://github.com/AraneaDev/minos/compare/v0.0.5...v0.0.6) (2026-09-16)


### Continuous integration

* **release:** allow Release Please to be run by hand ([#8](https://github.com/AraneaDev/minos/issues/8)) ([6ed12a7](https://github.com/AraneaDev/minos/commit/6ed12a7046569a4fb0ea822bd309b2cbd0e1765f))

## [0.0.5](https://github.com/AraneaDev/minos/compare/v0.0.4...v0.0.5) (2026-09-16)


### Continuous integration

* **pr-title:** check out the base branch, not the pull request's pinned base commit ([#6](https://github.com/AraneaDev/minos/issues/6)) ([9260c83](https://github.com/AraneaDev/minos/commit/9260c834199aa4c8b805dc65121be0d52752a9a7))

## [0.0.4](https://github.com/AraneaDev/minos/compare/v0.0.3...v0.0.4) (2026-09-16)


### Continuous integration

* **pr-title:** share one commit-style rule between CI and the hook ([#4](https://github.com/AraneaDev/minos/issues/4)) ([9f8eb18](https://github.com/AraneaDev/minos/commit/9f8eb18e302eb37c2646417d04f4b999c08d9803))

## [0.0.3](https://github.com/AraneaDev/minos/compare/v0.0.2...v0.0.3) (2026-09-15)


### Documentation

* **readme:** credit the author and link the write-up ([#2](https://github.com/AraneaDev/minos/issues/2)) ([2b1a57c](https://github.com/AraneaDev/minos/commit/2b1a57c6d872bdcdbda82a298955a29a746628ec))

## [0.0.2](https://github.com/AraneaDev/minos/compare/v0.0.1...v0.0.2) (2026-09-09)


### Features

* add the attribution harness that plants a known answer and checks for it ([e5a638e](https://github.com/AraneaDev/minos/commit/e5a638e9be8ad9c894470a45b887e6f4fbec21f1))
* add the core types and a command surface that reports it is empty ([7035c63](https://github.com/AraneaDev/minos/commit/7035c630d9a8e02bfa65c58642c54467d0c5ca86))
* assemble one session into the numbers the report needs ([e4c7dd8](https://github.com/AraneaDev/minos/commit/e4c7dd8530637f005b76e97b7f691a52373607de))
* attribute a record to the prompt that caused it, structurally ([4c7f1ce](https://github.com/AraneaDev/minos/commit/4c7f1ce7bef3f1e8a3339471f9a29451e5558d72))
* attribute a subagent's changes to the prompt that spawned it ([1d5e831](https://github.com/AraneaDev/minos/commit/1d5e831ab89de3736fdea9030405beb92cab2bba))
* build the per-file change ledger from the tool calls in a transcript ([3c42565](https://github.com/AraneaDev/minos/commit/3c42565f3c94717f66f21d202a494e94cf791dd3))
* **cli:** colour the report where stdout is a terminal ([3a7eddf](https://github.com/AraneaDev/minos/commit/3a7eddfe3835a41e1d74edcde1f38a35af3157f9))
* **file:** print a file's full operation history, not undone changes only ([8342ae3](https://github.com/AraneaDev/minos/commit/8342ae3d379a9f0c1eefcc0edd4e00514964b376))
* find the changes a later turn overwrote, reverted or discarded ([b847dd4](https://github.com/AraneaDev/minos/commit/b847dd44388208ba1806e3b7863cc5875c9eeab2))
* label a change by whether anything was ever put to the user ([9fd4e4e](https://github.com/AraneaDev/minos/commit/9fd4e4e2dcfb20b99eaae5128a21d6145a94d0d2))
* locate a project's transcripts, and verify the guessed directory name ([12d52d4](https://github.com/AraneaDev/minos/commit/12d52d418add572e75c1c75c3af843b54c228466))
* render the report, and strip what quoted text could do to a terminal ([842d30e](https://github.com/AraneaDev/minos/commit/842d30e7a52fe35e3f6db3762defa3976176a3db))
* replay a file's operations, and stop rather than diverge ([82b4cc3](https://github.com/AraneaDev/minos/commit/82b4cc3ed58c6584117c55bb6fc8a52403712487))
* **report:** caveat decided with the allow rules in force right now ([0f051ee](https://github.com/AraneaDev/minos/commit/0f051eea68f35cd20da45b096cb16a8221d1ff67))
* **report:** name the prompt behind each side of an UNDONE finding ([9e99d41](https://github.com/AraneaDev/minos/commit/9e99d41efad4843498b0297d55c0b209c1eaa86d))
* stream a transcript and count the lines that do not parse ([dd43d42](https://github.com/AraneaDev/minos/commit/dd43d4290e36e2d6d7dd378c72200d29d9a4e090))
* tell a typed prompt apart from the user records that are not one ([ce93a04](https://github.com/AraneaDev/minos/commit/ce93a0478efb22e56b7bda741f6954a35486d83b))
* wire the five commands to the session analysis ([5901bea](https://github.com/AraneaDev/minos/commit/5901bea039b07bd865d4da27efff91d9c5ba78cb))


### Fixes

* **cli:** answer the failure that actually happened, and reject a flag with no value ([a93d966](https://github.com/AraneaDev/minos/commit/a93d966691e645eb2c90918e58bf8babb05d10e3))
* **cli:** run under bun when the bin is linked onto PATH ([1211c9d](https://github.com/AraneaDev/minos/commit/1211c9da68994ae4644513ef41af20c4b70c119c))
* **commands:** sanitise transcript-derived timestamps before printing ([28088d7](https://github.com/AraneaDev/minos/commit/28088d7fbb64822738d95804197f9beeca1ff3c4))
* confirm changes survived using replayed content when base is available ([769b9ac](https://github.com/AraneaDev/minos/commit/769b9ac1ae4102c2096101c3ccd1b689f2a25dee))
* correct prompt detection, undone ordering and path column collision ([47eea58](https://github.com/AraneaDev/minos/commit/47eea58c4f9e08f8f9efa62cc3c779879dc92574))
* help text, coverage-enforcing CI, and two missing report caveats ([78f8037](https://github.com/AraneaDev/minos/commit/78f8037baa8c12c612fabadf29ecf1e81088b087))
* key the undone false-positive guard on recovered content, not on a base ([a51038c](https://github.com/AraneaDev/minos/commit/a51038c94f1397190586089f0789c1d61771ce4b))
* make constructor explicit to achieve full coverage ([b45252d](https://github.com/AraneaDev/minos/commit/b45252df45164aa08f98df578ca43724ceee4f0a))
* never crash on an unreadable transcript, and order sessions by mtime ([24d94c1](https://github.com/AraneaDev/minos/commit/24d94c16185694623a9d58ac28959f78814199d8))
* **report:** render every time in the reader's own zone, and name the day a change crossed ([fc9a429](https://github.com/AraneaDev/minos/commit/fc9a429cf4f9ad794d46a7b7b876d16e239e120e))
* **reverts:** apply the confirm-guard to the discarded branch too ([6332155](https://github.com/AraneaDev/minos/commit/6332155fab27bf6b30ef09ecf24ff7bb198a7b61))
* sanitise every transcript-derived field, align BY PROMPT, and add its header ([b41adbf](https://github.com/AraneaDev/minos/commit/b41adbf8c16d8819cad56a95228bde8679dc5b9e))
* **sessions:** resolve subagent transcripts for every listed session ([95adf7c](https://github.com/AraneaDev/minos/commit/95adf7ce724a7885ffe1e8fada3b7bc3fcd6148a))
* stop counting a trailing newline as an extra line in delta totals ([a919f56](https://github.com/AraneaDev/minos/commit/a919f5643195cdb2d1a2dfa9d4adaad5ecc5e2d8))
* use function replacement to insert newString literally, avoiding dollar-sequence corruption ([a9cd798](https://github.com/AraneaDev/minos/commit/a9cd798bf81bcbdf74c5f8439da942a9d5e12013))
* validate --limit and the file target, and stop the suffix false match ([47e665f](https://github.com/AraneaDev/minos/commit/47e665fa38b451383d8e63c4a657391323a29912))
* verify the recorded cwd on the encoded guess, not just the fallback scan ([e45f75e](https://github.com/AraneaDev/minos/commit/e45f75e1ce63d5119bf45837e2b4c77e351b8726))


### Documentation

* correct the README against the code it describes ([d4da4ec](https://github.com/AraneaDev/minos/commit/d4da4ec7dc8368f67afa14cbf8b05a9cd8990d31))
* name the confirm-guard's whole-file, under-reporting limitation ([8f5dfb5](https://github.com/AraneaDev/minos/commit/8f5dfb5a523588434be3a687dc09f8d1a6891c6b))
* regenerate the cards, and let the session list show this repository ([655bc5c](https://github.com/AraneaDev/minos/commit/655bc5cbf0c3d93d5e0a5b92f3368c63b80667fe))
* say how to install it, now that there is somewhere to install it from ([92eb647](https://github.com/AraneaDev/minos/commit/92eb6471165ab0c0904c01a74dbca91b1e0498ea))
* show real minos output in the README ([08be2cb](https://github.com/AraneaDev/minos/commit/08be2cb86c9d8b723c3da8ba1b69655093617f06))


### Tests

* isolate the isMeta guard in isPromptRecord ([af3634b](https://github.com/AraneaDev/minos/commit/af3634b322620f5f716e0eade4328cd86ca7873f))
* replace tautological transcript-vocabulary test with real checks ([0336b50](https://github.com/AraneaDev/minos/commit/0336b50e72e2808cd3072e27e0d63064042fb25f))
