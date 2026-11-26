import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHARACTER_SKINS } from '../config.js';

const SKIN_URLS = Object.fromEntries(
  Object.entries(import.meta.glob([
    '../../recursos-originales/Individual Characters/glTF/*.gltf',
    '!../../recursos-originales/Individual Characters/glTF/Worker.gltf',
  ], { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.split('/').pop(), url])
);

export class SkinPreview {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
    this.camera.position.set(0, 1, 4.2);
    this.camera.lookAt(0, 0.95, 0);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xe5f1d8, 0x4b3826, 2.2));
    const key = new THREE.DirectionalLight(0xffedcc, 3.2);
    key.position.set(-2.5, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9dc8d2, 1.3);
    fill.position.set(3, 2, -2);
    this.scene.add(fill);

    this.loader = new GLTFLoader();
    this.characters = new Map();
    this.current = null;
    this.requestId = 0;
    this.visible = false;
    this.frame = null;
    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  async show(id) {
    const requestId = ++this.requestId;
    let character = this.characters.get(id);
    if (!character) {
      const skin = CHARACTER_SKINS.find((item) => item.id === id);
      const url = id === 'worker' ? '/assets/models/worker.glb' : skin && SKIN_URLS[skin.file];
      if (!url) return false;
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.isSkinnedMesh) object.frustumCulled = false;
      });
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 1.8 / size.y;
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      const idle = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
      const mixer = new THREE.AnimationMixer(model);
      if (idle) mixer.clipAction(idle).play();
      character = { model, mixer };
      this.characters.set(id, character);
    }
    if (requestId !== this.requestId) return false;
    if (this.current?.model !== character.model) {
      if (this.current) this.scene.remove(this.current.model);
      this.current = character;
      character.model.rotation.y = 0;
      this.scene.add(character.model);
    }
    this.render();
    return true;
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) {
      this.resize();
      if (this.frame === null) {
        this.clock.start();
        this.frame = requestAnimationFrame(this.animate);
      }
    } else if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  render() {
    if (this.current && this.container.clientWidth > 0) this.renderer.render(this.scene, this.camera);
  }

  animate = () => {
    if (!this.visible) {
      this.frame = null;
      return;
    }
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.current) {
      this.current.mixer.update(delta);
      this.current.model.rotation.y += delta * 0.12;
    }
    this.render();
    this.frame = requestAnimationFrame(this.animate);
  };
}