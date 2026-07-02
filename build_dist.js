const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Create dist directory if it doesn't exist
if (!fs.existsSync(distDir)){
    fs.mkdirSync(distDir, { recursive: true });
}

// Files and folders to copy
const filesToCopy = [
    'index.html',
    'dashboard_app.html',
    'dashboard_logic.js',
    'dashboard_style.css',
    'admin.html',
    'Mitsuyoshi_System_Presentation.html',
    '_redirects',
    'dragon.webp',
    'lion.webp',
    'panda.webp',
    'phoenix.webp',
    'tigre.webp',
    'icon.png',
    'mitsuyoshi_presentation.pdf',
    'test.html',
    'rubix_logo.jpg'
];

// Copy files
filesToCopy.forEach(file => {
    const src = path.join(__dirname, file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to dist/`);
    }
});

// Copy all profit*.png images
fs.readdirSync(__dirname).forEach(file => {
    if (file.startsWith('profit') && file.endsWith('.png')) {
        const src = path.join(__dirname, file);
        const dest = path.join(distDir, file);
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to dist/`);
    }
});

console.log('Build completed successfully!');
