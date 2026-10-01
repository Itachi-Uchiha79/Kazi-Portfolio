import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { noise, sky } from './shaders/common.glsl.js'
import { uniforms } from './palette.js'


const material = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;            // always at the far plane
    }`,
  fragmentShader: /* glsl */ `
    ${noise}
    ${sky}
    uniform float uStars, uStarSize, uTwinkle, uMilkyWay, uSparkleStars;
    uniform vec3 uStarColor;
    varying vec3 vDir;

    float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    vec3 hash33(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.xxy + p.yxx) * p.zyx);
    }

    // Stars: one candidate per cell of a 3D grid on the sky sphere; keep = chance a cell has a star,
    // so the density is set by keep (the "stars" setting), not by brightness. Magnitude follows a steep
    // power law: a few big bright stars, more medium ones, many small faint ones. Every star is at least
    // a pixel wide (smaller ones would vanish) and twinkles; the brightest throw a soft 4-point glint.
    vec3 starLayer(vec3 d, float scale, float keep, float sizeK, float bright, float t) {
      vec3 p = d * scale;
      vec3 cell = floor(p);
      vec3 h = hash33(cell);
      if (h.x > keep) return vec3(0.0);
      vec3 c = cell + 0.2 + 0.6 * hash33(cell + 17.0);
      float dist = length(p - c);
      float mag = pow(hash31(cell + 5.0), 4.0);
      float px = length(fwidth(p));
      float r = px * uStarSize * sizeK * (0.9 + 1.6 * mag);                 // in pixels, whatever the scale
      float core = smoothstep(r, r * 0.25, dist);
      float halo = exp(-dist / (r * 1.8)) * 0.25 * mag;
      float tw = 1.0 - uTwinkle * 0.55 * (0.5 + 0.5 * sin(t * (1.5 + 4.0 * h.y) + h.z * 40.0));
      vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.93, 0.82), h.z);  // blue-white to warm
      vec3 t1 = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
      vec3 t2 = cross(d, t1);
      vec3 v = p - c;
      float fx = dot(v, t1), fy = dot(v, t2), L = r * 5.0 * uSparkleStars;
      float glint = (exp(-abs(fx) / L) * exp(-fy * fy / (r * r * 0.06)) + exp(-abs(fy) / L) * exp(-fx * fx / (r * r * 0.06)))
                  * smoothstep(0.5, 0.9, mag) * pow(0.5 + 0.5 * sin(t * (2.0 + 5.0 * h.y) + h.z * 30.0), 3.0) * 0.6;
      return tint * ((core + halo) * (0.3 + 0.9 * mag) * tw + glint) * bright;
    }

    // Milky Way: a luminous band across the sky, clumpy, with a dark dust lane down its middle and
    // a thick scatter of tiny stars; bluish at the edges, warmer in the core.
    vec3 milkyWay(vec3 d, float t, out float bandK) {
      // band plane: rises from the horizon on the left (az -42) up across the view (az 22, 30 deg high)
      vec3 axis = normalize(vec3(0.3599, -0.8503, -0.3840));
      float x = dot(d, axis);
      vec3 e1 = normalize(cross(axis, vec3(0.0, 1.0, 0.0))), e2 = cross(axis, e1);
      vec2 bp = vec2(atan(dot(d, e2), dot(d, e1)), x);                      // along / across the band
      float width = 0.2 + 0.05 * (fbm(vec2(bp.x * 2.0, 1.0)) - 0.5);
      float band = exp(-pow(x / width, 2.0));
      float clumps = fbm(bp * vec2(5.0, 18.0) + 3.0) * 0.7 + fbm(bp * vec2(14.0, 40.0)) * 0.5;
      float lane = exp(-pow((x - 0.02 * sin(bp.x * 3.0)) / 0.045, 2.0)) * smoothstep(0.35, 0.7, fbm(bp * vec2(8.0, 30.0) + 11.0));
      bandK = band * uMilkyWay;
      float glow = band * clumps * (1.0 - 0.8 * lane);
      vec3 col = mix(vec3(0.45, 0.55, 0.95), vec3(0.95, 0.88, 0.95), smoothstep(0.4, 0.95, band));
      vec3 dust = starLayer(d, 520.0, 0.55 * band, 0.7, 0.8, t);
      return (col * glow * 0.16 + dust) * uMilkyWay;
    }

    void main() {
      vec3 d = normalize(vDir);
      vec3 c = skyColor(d);
      if ((uStars > 0.001 || uMilkyWay > 0.001) && d.y > 0.0) {
        float el = asin(d.y) / DEG;
        float horizonFade = smoothstep(1.5, 12.0, el);                        // lost in the haze low down
        float n = clamp(uStars, 0.0, 3.0);                                    // "stars" = how many
        vec3 s = starLayer(d, 55.0, 0.10 * n, 2.2, 1.6, uTime)                // a few big bright ones
               + starLayer(d, 120.0, 0.12 * n, 1.4, 1.0, uTime * 1.3)        // medium
               + starLayer(d, 240.0, 0.10 * n, 1.0, 0.6, uTime * 0.8);       // many small faint ones
        float bandK;
        s += milkyWay(d, uTime, bandK);
        // hidden behind the moon / sun disc and washed out in its glow
        float aSun = acos(clamp(dot(d, uSunDir), -1.0, 1.0)) / DEG;
        float behind = mix(1.0, smoothstep(uSunDiscSize * 1.02, uSunDiscSize * 4.0, aSun), uSunVis);
        c += s * uStarColor * horizonFade * behind * (1.0 - 0.8 * uSunVis * (1.0 - uMoonLook));
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
})

// Sky dome that stays centred on the camera, so it is always "infinitely" far away.
export default function Sky() {
  const ref = useRef()
  useFrame(({ camera }) => ref.current.position.copy(camera.position))
  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[1000, 96, 48]} />
    </mesh>
  )
}
