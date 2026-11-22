# Prompt Lab — Android local inference prototype

This isolated Flutter app is a proof of concept. It is not the final Prompt Lab interface.

## What it verifies

1. Download a small GGUF model to app-private storage.
2. Load it through `flutter_local_llm` / llama.cpp.
3. Generate a short answer locally on CPU.
4. Confirm that no cloud AI API is used.

Test model: SmolLM-135M-Instruct Q4_K_M. It is intentionally small and only validates the inference pipeline; it is not the final quality model.

## Build

The GitHub Actions workflow creates the Android Flutter scaffold, copies this app source into it, and builds a debug APK.

## Important

GPU/Vulkan acceleration is deliberately disabled in this first test. CPU inference is the baseline. GPU acceleration will be evaluated separately only after a successful CPU test on a physical device.
