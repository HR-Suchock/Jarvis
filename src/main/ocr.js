'use strict';
// Reads the words on a picture with Windows' own offline text recogniser (Windows 10/11, no download, no AI token used).
// Returns '' when it is not available, so the caller can fall back to a vision AI.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PS = `param([string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $eng) { exit 3 }
$res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
($res.Lines | ForEach-Object { $_.Text }) -join "\`n"
`;

function ocrPng(pngBuf, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && !opts.force) return resolve('');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ocr-'));
    const img = path.join(dir, 'screen.png'), ps = path.join(dir, 'ocr.ps1');
    const done = (t) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } resolve(t || ''); };
    try { fs.writeFileSync(img, pngBuf); fs.writeFileSync(ps, '﻿' + PS, 'utf8'); } catch (e) { return done(''); }
    execFile(opts.shell || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Path', img],
      { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => done(err ? '' : String(out || '').trim()));
  });
}
module.exports = { ocrPng, PS };
