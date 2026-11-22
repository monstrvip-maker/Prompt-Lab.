import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_local_llm/flutter_local_llm.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const EngineTestApp());
}

class EngineTestApp extends StatelessWidget {
  const EngineTestApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Prompt Lab · Engine Test',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7057E8)),
        useMaterial3: true,
      ),
      home: const EngineTestScreen(),
    );
  }
}

class EngineTestScreen extends StatefulWidget {
  const EngineTestScreen({super.key});

  @override
  State<EngineTestScreen> createState() => _EngineTestScreenState();
}

class _EngineTestScreenState extends State<EngineTestScreen> {
  static const modelUrl =
      'https://huggingface.co/HuggingFaceTB/SmolLM-135M-Instruct-GGUF/resolve/main/smollm-135m-instruct-q4_k_m.gguf';

  final _input = TextEditingController(text: 'Привет! Кратко расскажи, что ты умеешь.');
  final _output = StringBuffer();
  String _status = 'Модель ещё не загружена';
  String _detail = 'Сначала скачай небольшую тестовую модель.';
  double _progress = 0;
  bool _busy = false;
  LocalLlmEngine? _engine;
  LlmSession? _session;

  Future<String> _modelPath() async {
    final dir = await getApplicationDocumentsDirectory();
    final modelsDir = Directory('${dir.path}/gguf_models');
    if (!await modelsDir.exists()) {
      await modelsDir.create(recursive: true);
    }
    return '${modelsDir.path}/smollm-135m-instruct-q4_k_m.gguf';
  }

  Future<void> _downloadAndLoad() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _progress = 0;
      _status = 'Подготовка загрузки';
      _detail = 'Загружаем тестовую модель на устройство.';
    });

    try {
      final path = await _modelPath();
      final file = File(path);
      if (!await file.exists() || await file.length() == 0) {
        final parent = file.parent;
        if (!await parent.exists()) {
          await parent.create(recursive: true);
        }
        final downloader = ModelDownloader();
        final finished = Completer<void>();
        final subscription = downloader.download(
          url: modelUrl,
          destinationPath: path,
          allowResume: true,
        ).listen(
          (item) {
            if (!mounted) return;
            setState(() {
              _progress = item.progress.clamp(0.0, 1.0).toDouble();
              _status = item.status == DownloadStatus.completed
                  ? 'Загрузка завершена'
                  : 'Загрузка модели';
              _detail =
                  '${(_progress * 100).toStringAsFixed(0)}% · ${item.speedFormatted}';
            });
            if (item.status == DownloadStatus.completed && !finished.isCompleted) {
              finished.complete();
            }
          },
          onError: (Object error, StackTrace stack) {
            if (!finished.isCompleted) finished.completeError(error, stack);
          },
          onDone: () {
            if (!finished.isCompleted) {
              finished.completeError(
                StateError('Загрузчик завершил поток без статуса completed.'),
              );
            }
          },
        );
        try {
          await finished.future.timeout(const Duration(minutes: 30));
        } finally {
          await subscription.cancel();
        }
        if (!await file.exists()) {
          throw FileSystemException('Загрузчик сообщил об окончании, но файл не найден', path);
        }
        final downloadedBytes = await file.length();
        if (downloadedBytes < 1024 * 1024) {
          throw FileSystemException(
            'Файл модели слишком мал: $downloadedBytes байт. Возможно, сервер вернул страницу ошибки.',
            path,
          );
        }
      } else {
        setState(() {
          _progress = 1;
          _status = 'Модель уже загружена';
        });
      }

      if (!mounted) return;
      setState(() {
        _status = 'Запуск локального движка';
        _detail = 'Проверяем запуск на CPU, без облака и без GPU-ускорения.';
      });

      _engine = await LocalLlmEngine.loadModel(
        modelPath: path,
        params: const ModelParams(
          contextSize: 1024,
          gpuLayers: 0,
        ),
      );
      _session = _engine!.createSession(
        defaultTemplate: const ChatMlTemplate(),
      );

      if (!mounted) return;
      setState(() {
        _status = 'Модель готова';
        _detail = 'Локальная модель загружена. Можно отправить тестовый запрос.';
        _progress = 1;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _status = 'Не удалось запустить модель';
        _detail = error.toString();
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final session = _session;
    final prompt = _input.text.trim();
    if (session == null || prompt.isEmpty || _busy) return;

    setState(() {
      _busy = true;
      _output.clear();
      _status = 'Модель генерирует ответ';
      _detail = 'Ответ создаётся непосредственно на устройстве.';
    });

    try {
      final stream = session.chat(
        [
          ChatMessage.system(
            'Ты — локальный тестовый помощник Prompt Lab. Отвечай кратко и понятно на русском языке.',
          ),
          ChatMessage.user(prompt),
        ],
        params: const SamplingParams(
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 160,
        ),
      );

      await for (final token in stream) {
        _output.write(token);
        if (mounted) setState(() {});
      }

      if (mounted) {
        setState(() {
          _status = 'Ответ получен локально';
          _detail = 'Тест генерации завершён.';
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _status = 'Ошибка генерации';
          _detail = error.toString();
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _session?.dispose();
    _engine?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Prompt Lab · Проверка ИИ')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Icon(Icons.memory_rounded, size: 52),
          const SizedBox(height: 12),
          Text(
            _status,
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(_detail, textAlign: TextAlign.center),
          const SizedBox(height: 18),
          LinearProgressIndicator(value: _progress == 0 ? null : _progress),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _busy || _session != null ? null : _downloadAndLoad,
            icon: const Icon(Icons.download_rounded),
            label: const Text('Скачать и запустить тестовую модель'),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _input,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Тестовый запрос',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy || _session == null ? null : _send,
            child: const Text('Проверить генерацию'),
          ),
          const SizedBox(height: 20),
          SelectableText(
            _output.isEmpty ? 'Здесь появится ответ модели.' : _output.toString(),
          ),
          const SizedBox(height: 24),
          const Text(
            'Это технический прототип. Он проверяет загрузку GGUF и локальную генерацию на CPU. Интерфейс и выбор финальной модели появятся позже.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
