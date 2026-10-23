import { useEffect, useRef, useState } from 'react';
import { EARTH_DAY, EARTH_NIGHT } from '../lib/earthTextures';
import { vscode } from '../services/vscode';

// Gerçekçi Dünya: bağımlılıksız küçük bir WebGL çizimi (three.js yok, ağ isteği yok).
// Tek bir piksel gölgelendiricisi: NASA gündüz dokusu, gece şehir ışıkları, 23,4° eksen
// eğikliği, gece/gündüz sınırı, okyanus parlaması ve atmosfer ışıması.
// Yalnız `running` iken çizer; 30 kare/sn (zayıf donanımda 20) ile sınırlıdır.

const VERT = `
attribute vec2 p;
varying vec2 v;
void main() { v = p; gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
varying vec2 v;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform float uSpin;
uniform vec3 uSun;
const float PI = 3.14159265;
const float TILT = 0.40910518; // 23.44°

void main() {
  vec2 q = v * 1.16;               // kenarda atmosfer için pay
  float r = length(q);
  vec3 atmo = vec3(0.32, 0.58, 1.0);

  // dış ışıma: aydınlık tarafta daha belirgin; kürenin kenarından kesintisiz başlar
  float side = clamp(dot(normalize(vec3(q, 0.15)), uSun) * 0.6 + 0.45, 0.0, 1.0);
  float glowA = exp(-max(r - 0.985, 0.0) * 16.0) * 0.6 * side;
  if (r > 1.0) {
    gl_FragColor = vec4(atmo * glowA, glowA);
    return;
  }

  vec3 n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
  // ekran → Dünya ekseni: önce eğikliği geri al, sonra kendi ekseninde döndür
  float ct = cos(TILT), st = sin(TILT);
  vec3 a = vec3(ct * n.x + st * n.y, -st * n.x + ct * n.y, n.z);
  float cs = cos(uSpin), ss = sin(uSpin);
  vec3 b = vec3(cs * a.x + ss * a.z, a.y, -ss * a.x + cs * a.z);
  float lon = atan(b.x, b.z);
  float lat = asin(clamp(b.y, -1.0, 1.0));
  vec2 uv = vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);

  vec3 day = texture2D(uDay, uv).rgb;
  float city = texture2D(uNight, uv).r;
  float diff = dot(n, uSun);
  float lit = smoothstep(-0.10, 0.25, diff);

  vec3 col = day * (0.05 + 1.1 * max(diff, 0.0)) * lit;
  // gece tarafında şehir ışıkları
  col += vec3(1.0, 0.76, 0.42) * pow(city, 1.8) * 1.4 * (1.0 - smoothstep(-0.22, 0.06, diff));
  // okyanus parlaması
  float ocean = smoothstep(0.02, 0.18, day.b - max(day.r, day.g) * 0.85);
  vec3 h = normalize(uSun + vec3(0.0, 0.0, 1.0));
  col += vec3(0.95, 0.97, 1.0) * pow(max(dot(n, h), 0.0), 120.0) * 0.28 * ocean * lit;
  // kenar atmosferi
  float rim = pow(1.0 - n.z, 2.6);
  col += atmo * rim * (0.18 + 0.7 * lit);

  // kenar yumuşatma: küre kenarda dış ışımaya karışır (noktalı halka olmasın)
  float edge = smoothstep(1.0, 0.982, r);
  vec3 outC = col * edge + atmo * glowA * (1.0 - edge);
  float outA = edge + glowA * (1.0 - edge);
  gl_FragColor = vec4(outC, outA);
}
`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const log = (text: string, level: 'info' | 'error' = 'info') => {
  try { vscode.postMessage({ type: 'clientLog', level, text: `Dünya: ${text}` }); } catch { /* yoksay */ }
};

export function EarthGlobe({ size, running, lowPower }: { size: number; running: boolean; lowPower: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const kickRef = useRef<() => void>(() => undefined);
  // WebGL yalnız Dünya ilk kez ekrandan geçerken kurulur; açılışta ekran kartına dokunulmaz.
  const [started, setStarted] = useState(false);
  useEffect(() => { if (running) setStarted(true); }, [running]);

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    // failIfMajorPerformanceCaveat: ekran kartı yoksa yazılımla (yavaş) çizmek yerine hiç çizme
    const gl = canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false,
      powerPreference: 'low-power', failIfMajorPerformanceCaveat: true,
    });
    if (!gl) { canvas.dataset.unsupported = '1'; log('WebGL yok ya da yalnız yazılımla çalışıyor, küre gösterilmiyor'); return; }
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      log(`WebGL hazır · ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
    } catch { /* yoksay */ }
    const onLost = (e: Event) => { e.preventDefault(); canvas.dataset.unsupported = '1'; log('WebGL bağlamı kayboldu', 'error'); };
    canvas.addEventListener('webglcontextlost', onLost);

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.dataset.unsupported = '1';
      log(`gölgelendirici derlenemedi: ${gl.getProgramInfoLog(prog) ?? ''}`, 'error');
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uSpin = gl.getUniformLocation(prog, 'uSpin');
    const uSun = gl.getUniformLocation(prog, 'uSun');
    // Güneş sol üst önden: küre hacimli görünür, sağda gece tarafı ve şehir ışıkları
    const sun = [-0.62, 0.32, 0.72];
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    gl.uniform3f(uSun, sun[0] / len, sun[1] / len, sun[2] / len);

    let disposed = false;
    let raf = 0;
    let last = 0;
    // spin = ekranın ortasındaki boylam (radyan). Açılışta orta ~60°D: Türkiye (35°D)
    // ortanın solunda, aydınlık tarafta; dönüşle sağdaki gece tarafına doğru ilerler.
    let spin = 1.05;
    const frameMs = lowPower ? 50 : 33;
    // Gerçek yön: yüzey batıdan doğuya (ekranda soldan sağa) akar → orta boylam azalır.
    // Hız görsel: 70 sn'de bir tur.
    const SPEED = -(Math.PI * 2) / 70;

    const draw = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uSpin, spin);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const tick = (t: number) => {
      if (disposed || !runningRef.current) { raf = 0; return; }
      if (t - last >= frameMs) {
        spin += SPEED * Math.min(0.1, (t - (last || t)) / 1000);
        last = t;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    kickRef.current = () => {
      if (!raf && runningRef.current && !disposed) { last = 0; raf = requestAnimationFrame(tick); }
    };

    const texture = (img: HTMLImageElement, unit: number, name: string) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // mipmap yok: boylam dikişinde çizgi çıkmasın
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    };

    void Promise.all([loadImage(EARTH_DAY), loadImage(EARTH_NIGHT)]).then(([d, n]) => {
      if (disposed) return;
      texture(d, 0, 'uDay');
      texture(n, 1, 'uNight');
      canvas.dataset.ready = '1';
      draw();
      kickRef.current();
    }).catch(() => { canvas.dataset.unsupported = '1'; });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [size, lowPower, started]);

  useEffect(() => { if (running) kickRef.current(); }, [running]);

  return <canvas ref={canvasRef} className="tz-globe" style={{ width: size, height: size }} aria-hidden />;
}
