import { ZstPackage } from "./zstd";

(async () => {
  const pkg = await ZstPackage.open("/assets.zst");
  console.log(pkg.list());

  const imgURL = await pkg.getURL("textures/hero.webp");
  const audioURL = await pkg.getURL("audio/bgm.ogg");

  const img = new Image();
  img.src = imgURL;
  document.body.appendChild(img);

  const audio = new Audio(audioURL);
  audio.loop = true;
  await audio.play();
})();