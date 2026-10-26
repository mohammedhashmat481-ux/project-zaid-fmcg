const https = require('https');
const fs = require('fs');

const baseUrl = 'https://raw.githubusercontent.com/WebDevSimplified/Face-Detection-JavaScript/master/models/';
const files = [
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.weights',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.weights',
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.weights'
];

files.forEach(file => {
  https.get(baseUrl + file, (res) => {
    const stream = fs.createWriteStream(file);
    res.pipe(stream);
    stream.on('finish', () => console.log('Downloaded', file));
  });
});
