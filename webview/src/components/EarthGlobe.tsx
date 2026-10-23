import { useEffect, useRef, useState } from 'react';
import { EARTH_DAY, EARTH_NIGHT } from '../lib/earthTextures';
import { MOON_TEXTURE } from '../lib/moonTexture';
import { vscode } from '../services/vscode';

// Gerçekçi gök cisimleri: bağımlılıksız küçük bir WebGL çizimi (three.js yok, ağ isteği yok).
// Dünya: NASA gündüz dokusu, gece şehir ışıkları, 23,4° eksen eğikliği, gece/gündüz sınırı,
// okyanus parlaması ve atmosfer ışıması. Ay: LRO dokusu, atmosfersiz keskin gündüz/gece sınırı,
// regolitin ışığı geri yansıtması (dolunayda disk düz görünür) ve hafif Dünya ışığı.
// Yalnız `running` iken çizer; 30 kare/sn (zayıf donanımda 20) ile sınırlıdır.

const VERT = `
attribute vec2 p;
varying vec2 v;
void main() { v = p; gl_Position = vec4(p, 0.0, 1.0); }
`;

const EARTH_FRAG = `
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

const MOON_FRAG = `
precision mediump float;
varying vec2 v;
uniform sampler2D uDay;
uniform float uSpin;
uniform vec3 uSun;
const float PI = 3.14159265;
const float TILT = 0.1169; // 6.7°

void main() {
  vec2 q = v * 1.02;
  float r = length(q);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec3 n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
  float ct = cos(TILT), st = sin(TILT);
  vec3 a = vec3(ct * n.x + st * n.y, -st * n.x + ct * n.y, n.z);
  float cs = cos(uSpin), ss = sin(uSpin);
  vec3 b = vec3(cs * a.x + ss * a.z, a.y, -ss * a.x + cs * a.z);
  float lon = atan(b.x, b.z);
  float lat = asin(clamp(b.y, -1.0, 1.0));
  vec3 alb = texture2D(uDay, vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI)).rgb;
  alb = pow(alb, vec3(1.15)) * 1.25; // denizler (koyu ovalar) belirginleşsin

  float mu0 = max(dot(n, uSun), 0.0);
  float mu = max(n.z, 0.001);
  // Lommel–Seeliger + Lambert karışımı: kenara doğru kararmayan, gerçek Ay görünümü
  float shade = mix(mu0, 2.0 * mu0 / (mu0 + mu), 0.7);
  float lit = smoothstep(-0.02, 0.06, dot(n, uSun));
  vec3 col = alb * shade * lit;
  // gece tarafında çok hafif Dünya ışığı
  col += alb * vec3(0.55, 0.65, 0.85) * 0.05 * (1.0 - lit);

  float edge = smoothstep(1.0, 0.975, r);
  gl_FragColor = vec4(col * edge, edge);
}
`;

type Body = 'earth' | 'moon';

// Cisme göre gölgelendirici, dokular, Güneş yönü ve dönüş
const BODIES: Record<Body, {
  frag: string; textures: [string, string][]; sun: [number, number, number]; spin: number; speed: number;
}> = {
  // Güneş sol üst önden: küre hacimli görünür, sağda gece tarafı ve şehir ışıkları.
  // spin = ekranın ortasındaki boylam (radyan). Açılışta orta ~60°D: Türkiye (35°D)
  // ortanın solunda, aydınlık tarafta; dönüşle sağdaki gece tarafına doğru ilerler.
  // Gerçek yön: yüzey batıdan doğuya (ekranda soldan sağa) akar → orta boylam azalır. 70 sn'de bir tur.
  earth: { frag: EARTH_FRAG, textures: [[EARTH_DAY, 'uDay'], [EARTH_NIGHT, 'uNight']], sun: [-0.62, 0.32, 0.72], spin: 1.05, speed: -(Math.PI * 2) / 70 },
  // Ay hep aynı yüzünü gösterir (orta boylam 0); çok yavaş salınım yalnız canlılık için.
  // Güneş soldan: şişkin ay evresi.
  moon: { frag: MOON_FRAG, textures: [[MOON_TEXTURE, 'uDay']], sun: [-0.86, 0.18, 0.48], spin: 0, speed: -(Math.PI * 2) / 900 },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const log = (text: string, level: 'info' | 'error' = 'info') => {
  try { vscode.postMessage({ type: 'clientLog', level, text: `Gök cismi: ${text}` }); } catch { /* yoksay */ }
};

export function EarthGlobe({ size, running, lowPower, body = 'earth' }: {
  size: number; running: boolean; lowPower: boolean; body?: Body;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const kickRef = useRef<() => void>(() => undefined);
  // WebGL yalnız cisim ilk kez ekrandan geçerken kurulur; açılışta ekran kartına dokunulmaz.
  const [started, setStarted] = useState(false);
  useEffect(() => { if (running) setStarted(true); }, [running]);

  useEffect(() => {
    if (!started) return;
    const cfg = BODIES[body];
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
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, cfg.frag));
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
    const sun = cfg.sun;
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    gl.uniform3f(uSun, sun[0] / len, sun[1] / len, sun[2] / len);

    let disposed = false;
    let raf = 0;
    let last = 0;
    let spin = cfg.spin;
    const frameMs = lowPower ? 50 : 33;
    const SPEED = cfg.speed;

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

    void Promise.all(cfg.textures.map(([src]) => loadImage(src))).then((imgs) => {
      if (disposed) return;
      imgs.forEach((img, i) => texture(img, i, cfg.textures[i][1]));
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
  }, [size, lowPower, started, body]);

  useEffect(() => { if (running) kickRef.current(); }, [running]);

  return <canvas ref={canvasRef} className="tz-globe" style={{ width: size, height: size }} aria-hidden />;
}
