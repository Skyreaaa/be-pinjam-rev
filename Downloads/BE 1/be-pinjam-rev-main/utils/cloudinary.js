const { v2: cloudinary } = require('cloudinary');

function isConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function ensureConfigured() {
  if (!isConfigured()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  return true;
}

async function uploadBufferToCloudinary(buffer, { folder = 'uploads', publicId, resourceType = 'image', mimetype } = {}) {
  ensureConfigured();
  const base64 = buffer.toString('base64');
  const dataUri = `data:${mimetype || 'application/octet-stream'};base64,${base64}`;
  const options = { folder };
  if (publicId) options.public_id = publicId;
  if (resourceType) options.resource_type = resourceType;
  const result = await cloudinary.uploader.upload(dataUri, options);
  return result; // contains secure_url, public_id, etc.
}

function extractPublicIdFromUrl(url) {
  try {
    // Example: https://res.cloudinary.com/<cloud>/image/upload/v1699999999/folder/name.jpg
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const uploadIndex = parts.findIndex(p => p === 'upload');
    if (uploadIndex === -1) return null;
    const after = parts.slice(uploadIndex + 2).join('/'); // skip 'upload' and version 'v123'
    if (!after) return null;
    const noExt = after.replace(/\.[^.]+$/, '');
    return noExt;
  } catch {
    return null;
  }
}

async function deleteByUrl(url) {
  ensureConfigured();
  const publicId = extractPublicIdFromUrl(url);
  if (!publicId) return { result: 'not_found' };
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    return { result: 'error', error: e.message };
  }
}

module.exports = {
  cloudinary,
  isConfigured,
  ensureConfigured,
  uploadBufferToCloudinary,
  extractPublicIdFromUrl,
  deleteByUrl,
};
