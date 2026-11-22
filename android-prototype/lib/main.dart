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
      'https://huggingface.co/tensorblock/SmolLM-135M-Instruct-GGUF/resolve/main/SmolLM-135M-Instruct-Q2_K.gguf';

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
    return '${modelsDir.path}/SmolLM-135M-Instruct-Q2_K.gguf';
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
        // Use a direct HTTP download instead of relying on the package stream
        // to emit a terminal status event. Some plugin versions close the
        // stream without sending DownloadStatus.completed.
        final tempFile = File('$path.part');
        if (await tempFile.exists()) {
          await tempFile.delete();
        }
        final client = HttpClient()
          ..connectionTimeout = const Duration(seconds: 30)
          ..idleTimeout = const Duration(seconds: 60);
        IOSink? sink;
        try {
          final request = await client.getUrl(Uri.parse(modelUrl));
          request.headers.set(HttpHeaders.acceptEncodingHeader, 'identity');
          final response = await request.close();
          if (response.statusCode != HttpStatus.ok) {
            throw HttpException(
              'Сервер вернул HTTP ${response.statusCode}',
              uri: response.redirects.isNotEmpty
                  ? response.redirects.last.location
                  : Uri.parse(modelUrl),
            );
          }
          final totalBytes = response.contentLength;
          sink = tempFile.openWrite();
          var receivedBytes = 0;
          setState(() {
            _status = 'Загрузка модели';
            _detail = totalBytes > 0
                ? '0% · Подключение установлено'
                : 'Подключение установлено';
          });

          await for (final chunk in response) {
            sink.add(chunk);
            receivedBytes += chunk.length;
            if (!mounted) return;
            setState(() {
              _progress = totalBytes > 0
                  ? (receivedBytes / totalBytes).clamp(0.0, 1.0).toDouble()
                  : 0;
              _status = 'Загрузка модели';
              _detail = totalBytes > 0
                  ? '${(_progress * 100).toStringAsFixed(0)}% · ${(receivedBytes / (1024 * 1024)).toStringAsFixed(1)} МБ'
                  : '${(receivedBytes / (1024 * 1024)).toStringAsFixed(1)} МБ загружено';
            });
          }

          await sink.flush();
          await sink.close();
          sink = null;

          final actualBytes = await tempFile.length();
          if (actualBytes < 1024 * 1024) {
            throw FileSystemException(
              'Скачанный файл слишком мал ($actualBytes байт). Сервер мог вернуть HTML вместо модели.',
              tempFile.path,
            );
          }
          if (totalBytes > 0 && actualBytes != totalBytes) {
            throw FileSystemException(
              'Загрузка неполная: получено $actualBytes из $totalBytes байт.',
              tempFile.path,
            );
          }
          if (await file.exists()) {
            await file.delete();
          }
          await tempFile.rename(path);
        } catch (_) {
          if (sink != null) {
            await sink.close();
          }
          rethrow;
        } finally {
          client.close(force: true);
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
