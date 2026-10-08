export async function captureWindow() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw Error('Снимок окна недоступен в этом браузере. Можно приложить готовый файл.');
  let stream, video;
  try {
    // Must run directly from the user's click. The browser chooses/grants the source.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false, selfBrowserSurface: 'include', systemAudio: 'exclude' });
    video = document.createElement('video'); video.muted = true; video.srcObject = stream;
    await Promise.race([video.play(), new Promise((_, reject) => setTimeout(() => reject(Error('Не удалось прочитать снимок окна.')), 10000))]);
    if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > 32 * 1024 * 1024) throw Error('Размер снимка слишком большой или неизвестен.');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw Error('Не удалось сохранить снимок окна.');
    return new File([blob], 'window-screenshot.png', { type: 'image/png' });
  } catch (error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') throw Error('Снимок отменён. Можно повторить или приложить файл.');
    throw error;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    if (video) video.srcObject = null;
  }
}

export const readFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('Файл не прочитан.')); reader.readAsDataURL(file);
});

export async function editImage(canvas, file) {
  const image = new Image(); image.src = await readFile(file); await image.decode();
  if (image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024) throw Error('Изображение слишком большое для редактирования.');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d'), strokes = [];
  let drawing = null;
  const redraw = () => {
    ctx.drawImage(image, 0, 0);
    ctx.strokeStyle = '#e11d48'; ctx.lineWidth = Math.max(4, canvas.width / 300); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of [...strokes, ...(drawing ? [drawing] : [])]) {
      ctx.beginPath(); stroke.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  };
  const point = event => { const box = canvas.getBoundingClientRect(); return [(event.clientX - box.left) * canvas.width / box.width, (event.clientY - box.top) * canvas.height / box.height]; };
  canvas.onpointerdown = event => { if (event.button !== 0) return; drawing = [point(event)]; canvas.setPointerCapture(event.pointerId); redraw(); };
  canvas.onpointermove = event => { if (drawing) { drawing.push(point(event)); redraw(); } };
  const finish = () => { if (drawing) { strokes.push(drawing); drawing = null; redraw(); } };
  canvas.onpointerup = finish; canvas.onpointercancel = () => { drawing = null; redraw(); };
  redraw();
  return {
    undo: () => { strokes.pop(); redraw(); }, clear: () => { strokes.length = 0; redraw(); },
    save: async () => { finish(); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error('Изображение не сохранено.'); return new File([blob], 'annotated-screenshot.png', { type: 'image/png' }); }
  };
}
