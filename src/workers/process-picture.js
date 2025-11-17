// process-picture.js
const sharp = require('sharp');

module.exports = async function processPicture(buffer) {
  // Resize avatar
  const avatarBuffer = await sharp(buffer)
    .resize(256, 256)
    .jpeg({ quality: 90 })
    .toBuffer();

  return avatarBuffer;
};
