let uploadedImages = [];
let placedImages = [];
let imageIdCounter = 0;
let selectedImage = null;
let selectedImages = []; // For multi-select
let isDragging = false;
let isResizing = false;
let isMarqueeSelecting = false;
let dragOffset = { x: 0, y: 0 };
let resizeData = null;
let marqueeData = null;
let canvasZoom = 1; // Canvas zoom level (affects visual size only)

const DPI = 300; // DPI for poster printing
const STORAGE_KEY = 'posterPlacerState'; // LocalStorage key
let isRestoring = false; // Flag to prevent saving during restoration

// Undo history
const MAX_HISTORY = 50;
let stateHistory = [];
let lastSavedState = null;

// Letter paper size in pixels (8.5" x 11")
const LETTER_WIDTH = 8.5 * DPI;  // 2550px
const LETTER_HEIGHT = 11 * DPI;  // 3300px

// Standard poster and photo sizes (in inches) - based on Walmart sizes
// Sorted from smallest to largest by area
const STANDARD_SIZES = [
    { w: 4, h: 6, name: '4×6' },
    { w: 5, h: 7, name: '5×7' },
    { w: 8, h: 10, name: '8×10' },
    { w: 8.5, h: 11, name: '8.5×11' },
    { w: 11, h: 14, name: '11×14' },
    { w: 12, h: 18, name: '12×18' },
    { w: 16, h: 20, name: '16×20' },
    { w: 18, h: 24, name: '18×24' },
    { w: 20, h: 30, name: '20×30' },
    { w: 24, h: 36, name: '24×36' }
];

// Check if dimensions exceed letter paper size
function isLargerThanLetter(width, height) {
    // Won't fit on letter paper in either orientation
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);
    return minDim > LETTER_WIDTH || maxDim > LETTER_HEIGHT;
}

// Find the best standard size for given dimensions
function findBestStandardSize(widthPx, heightPx) {
    const widthIn = widthPx / DPI;
    const heightIn = heightPx / DPI;
    const isPortrait = heightIn > widthIn;
    
    // Normalize to compare (always width < height for comparison)
    const minIn = Math.min(widthIn, heightIn);
    const maxIn = Math.max(widthIn, heightIn);
    
    // Find the largest standard size that fits within the image dimensions
    let bestMatch = null;
    
    for (let i = STANDARD_SIZES.length - 1; i >= 0; i--) {
        const size = STANDARD_SIZES[i];
        // Standard sizes are listed as width x height where width < height
        if (size.w <= minIn && size.h <= maxIn) {
            bestMatch = size;
            break;
        }
    }
    
    if (!bestMatch) {
        // Default to smallest size
        bestMatch = STANDARD_SIZES[0];
    }
    
    // Return in correct orientation
    if (isPortrait) {
        return { width: bestMatch.w * DPI, height: bestMatch.h * DPI, name: bestMatch.name };
    } else {
        return { width: bestMatch.h * DPI, height: bestMatch.w * DPI, name: bestMatch.name };
    }
}

// Save state to LocalStorage
function saveState() {
    if (isRestoring) return; // Don't save during restoration
    
    // Push previous state to history before saving new one
    if (lastSavedState) {
        stateHistory.push(lastSavedState);
        if (stateHistory.length > MAX_HISTORY) {
            stateHistory.shift(); // Remove oldest
        }
    }
    
    // Check if source image is from Posters folder
    const getSourceInfo = (img) => {
        const sourceImg = uploadedImages.find(u => u.id === img.sourceId);
        const isFromPosters = sourceImg ? sourceImg.isFromPosters : false;
        return { isFromPosters, src: isFromPosters ? null : img.src };
    };
    
    const state = {
        placedImages: placedImages.map(img => {
            const sourceInfo = img.type === 'block' ? {} : getSourceInfo(img);
            return {
                type: img.type || 'image',
                sourceId: img.sourceId,
                name: img.name,
                width: img.width,
                height: img.height,
                maxWidth: img.maxWidth,
                maxHeight: img.maxHeight,
                x: img.x,
                y: img.y,
                preSnapWidth: img.preSnapWidth,
                preSnapHeight: img.preSnapHeight,
                isFromPosters: sourceInfo.isFromPosters,
                src: sourceInfo.src  // Only save src for uploaded images (not from Posters)
            };
        }),
        canvasZoom: canvasZoom,
        wallPreset: wallPreset.value,
        showLabels: showLabelsToggle.checked,
        showHandles: showHandlesToggle.checked,
        snapToPoster: snapToPosterToggle.checked
    };
    
    lastSavedState = JSON.stringify(state); // Store for next undo
    
    try {
        localStorage.setItem(STORAGE_KEY, lastSavedState);
    } catch (e) {
        console.error('Could not save state:', e);
    }
}

// Undo last action
function undo() {
    if (stateHistory.length === 0) return;
    
    const previousState = stateHistory.pop();
    
    // Clear current canvas
    placedImages.forEach(img => {
        const element = document.getElementById(img.id);
        if (element) element.remove();
    });
    placedImages = [];
    selectedImage = null;
    selectedImages = [];
    
    // Restore previous state
    const state = JSON.parse(previousState);
    lastSavedState = previousState;
    
    try {
        localStorage.setItem(STORAGE_KEY, previousState);
    } catch (e) {
        console.error('Could not save state:', e);
    }
    
    restoreState(state);
}

// Load state from LocalStorage
function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            lastSavedState = saved; // Initialize for undo history
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Could not load state:', e);
    }
    return null;
}

// Restore canvas state after images are loaded
function restoreState(state) {
    if (!state) return;
    
    isRestoring = true;
    
    // Restore settings
    canvasZoom = state.canvasZoom || 1;
    
    if (state.wallPreset) {
        wallPreset.value = state.wallPreset;
        updateWallGuide(false);
    }
    
    if (typeof state.showLabels === 'boolean') {
        showLabelsToggle.checked = state.showLabels;
        toggleLabels();
    }
    
    if (typeof state.showHandles === 'boolean') {
        showHandlesToggle.checked = state.showHandles;
        toggleHandles();
    }
    
    if (typeof state.snapToPoster === 'boolean') {
        snapToPosterToggle.checked = state.snapToPoster;
    }
    
    // Restore placed images and blocks
    if (state.placedImages && state.placedImages.length > 0) {
        state.placedImages.forEach(savedItem => {
            if (savedItem.type === 'block') {
                // Restore a block
                const blockData = {
                    id: `block-${Date.now()}-${Math.random()}`,
                    type: 'block',
                    name: savedItem.name,
                    width: savedItem.width,
                    height: savedItem.height,
                    maxWidth: savedItem.maxWidth,
                    maxHeight: savedItem.maxHeight,
                    x: savedItem.x,
                    y: savedItem.y
                };
                
                placedImages.push(blockData);
                renderPosterBlock(blockData);
            } else {
                // Try to find source image from Posters folder by name
                let sourceImg = uploadedImages.find(img => img.name === savedItem.name);
                let imageSrc = null;
                
                if (sourceImg) {
                    // Found in Posters folder
                    imageSrc = sourceImg.src;
                } else if (savedItem.src) {
                    // Uploaded image - use saved src data URL
                    imageSrc = savedItem.src;
                    // Also re-add to uploadedImages so it appears in sidebar
                    sourceImg = {
                        id: imageIdCounter++,
                        name: savedItem.name,
                        src: savedItem.src,
                        thumbSrc: savedItem.src,
                        width: savedItem.maxWidth,
                        height: savedItem.maxHeight,
                        isFromPosters: false
                    };
                    uploadedImages.push(sourceImg);
                    addImageToSidebar(sourceImg);
                }
                
                if (imageSrc) {
                    const placedImageData = {
                        id: `placed-${Date.now()}-${Math.random()}`,
                        sourceId: sourceImg.id,
                        name: savedItem.name,
                        src: imageSrc,
                        maxWidth: savedItem.maxWidth,
                        maxHeight: savedItem.maxHeight,
                        width: savedItem.width,
                        height: savedItem.height,
                        x: savedItem.x,
                        y: savedItem.y,
                        preSnapWidth: savedItem.preSnapWidth,
                        preSnapHeight: savedItem.preSnapHeight
                    };
                    
                    placedImages.push(placedImageData);
                    renderPlacedImage(placedImageData);
                    
                    // Check if over max and apply class
                    if (savedItem.width > savedItem.maxWidth || savedItem.height > savedItem.maxHeight) {
                        const element = document.getElementById(placedImageData.id);
                        if (element) element.classList.add('over-max');
                    }
                } else {
                    console.warn('Could not restore image:', savedItem.name);
                }
            }
        });
        
        updateAllVisuals();
        updateCurrentSizeDisplay();
        toggleLabels();
        toggleHandles();
    }
    
    isRestoring = false;
}

// Clear saved state
function clearState() {
    localStorage.removeItem(STORAGE_KEY);
}

// Clear canvas
function clearCanvas() {
    // Remove all placed images from DOM
    placedImages.forEach(img => {
        const element = document.getElementById(img.id);
        if (element) element.remove();
    });
    
    // Clear arrays
    placedImages = [];
    selectedImage = null;
    selectedImages = [];
    
    // Reset zoom
    canvasZoom = 1;
    
    // Clear saved state
    clearState();
    
    // Update display
    updateCurrentSizeDisplay();
    updateAllVisuals();
}

function removeUploadedImages() {
    // Get IDs of uploaded images (not from Posters folder)
    const uploadedIds = uploadedImages
        .filter(img => !img.isFromPosters)
        .map(img => img.id);
    
    // Remove placed images that came from uploaded images
    const placedToRemove = placedImages.filter(img => 
        !img.type && uploadedIds.includes(img.sourceId)
    );
    
    placedToRemove.forEach(img => {
        const element = document.getElementById(img.id);
        if (element) element.remove();
    });
    
    placedImages = placedImages.filter(img => 
        img.type === 'block' || !uploadedIds.includes(img.sourceId)
    );
    
    // Remove from sidebar
    uploadedImages
        .filter(img => !img.isFromPosters)
        .forEach(img => {
            const sidebarItem = Array.from(imageList.querySelectorAll('.image-item'))
                .find(item => item.dataset.name === img.name.toLowerCase());
            if (sidebarItem) sidebarItem.remove();
        });
    
    // Remove from uploadedImages array
    uploadedImages = uploadedImages.filter(img => img.isFromPosters);
    
    // Clear selection if it was an uploaded image
    selectedImage = null;
    selectedImages = [];
    
    // Update display
    updateCurrentSizeDisplay();
    saveState();
}

// File upload handling
const fileInput = document.getElementById('fileInput');
const imageList = document.getElementById('imageList');
const mainArea = document.getElementById('mainArea');
const resizeCanvasBtn = document.getElementById('resizeCanvasBtn');
const placeAllBtn = document.getElementById('placeAllBtn');
const showLabelsToggle = document.getElementById('showLabelsToggle');
const showHandlesToggle = document.getElementById('showHandlesToggle');
const snapToPosterToggle = document.getElementById('snapToPosterToggle');
const currentSizeDisplay = document.getElementById('currentSize');
const wallPreset = document.getElementById('wallPreset');
const moveOutOfGuide = document.getElementById('moveOutOfGuide');
const clearCanvasBtn = document.getElementById('clearCanvasBtn');
const removeUploadedBtn = document.getElementById('removeUploadedBtn');
const add18x24Btn = document.getElementById('add18x24');
const add24x36Btn = document.getElementById('add24x36');

const WALL_PRESETS = {
    none: null,
    dorm: { width: 80, height: 40, name: 'Dorm' }
};

fileInput.addEventListener('change', handleFileUpload);
resizeCanvasBtn.addEventListener('click', resizeCanvasToFit);
placeAllBtn.addEventListener('click', placeAllImages);
showLabelsToggle.addEventListener('change', toggleLabels);
showHandlesToggle.addEventListener('change', toggleHandles);
snapToPosterToggle.addEventListener('change', toggleSnapToPoster);

function toggleSnapToPoster() {
    const shouldSnap = snapToPosterToggle.checked;
    
    // Get images to snap - either selected ones or all placed images
    const imagesToSnap = selectedImages.length > 0 
        ? placedImages.filter(img => selectedImages.includes(img.id) && !isBlock(img))
        : placedImages.filter(img => !isBlock(img));
    
    if (shouldSnap) {
        // Snap to poster sizes
        imagesToSnap.forEach(img => {
            // Store original dimensions if not already stored
            if (!img.preSnapWidth) {
                img.preSnapWidth = img.width;
                img.preSnapHeight = img.height;
            }
            
            const bestSize = findBestStandardSize(img.preSnapWidth, img.preSnapHeight);
            img.width = bestSize.width;
            img.height = bestSize.height;
            
            // Update DOM
            const element = document.getElementById(img.id);
            if (element) {
                element.style.width = `${toVisual(img.width)}px`;
                element.style.height = `${toVisual(img.height)}px`;
                updateImageInfo(element, img.width, img.height);
                
                // Update over-max class
                if (img.width > img.maxWidth || img.height > img.maxHeight) {
                    element.classList.add('over-max');
                } else {
                    element.classList.remove('over-max');
                }
            }
        });
    } else {
        // Revert to original sizes
        imagesToSnap.forEach(img => {
            if (img.preSnapWidth) {
                img.width = img.preSnapWidth;
                img.height = img.preSnapHeight;
                delete img.preSnapWidth;
                delete img.preSnapHeight;
                
                // Update DOM
                const element = document.getElementById(img.id);
                if (element) {
                    element.style.width = `${toVisual(img.width)}px`;
                    element.style.height = `${toVisual(img.height)}px`;
                    updateImageInfo(element, img.width, img.height);
                    
                    // Update over-max class
                    if (img.width > img.maxWidth || img.height > img.maxHeight) {
                        element.classList.add('over-max');
                    } else {
                        element.classList.remove('over-max');
                    }
                }
            }
        });
    }
    
    updateCurrentSizeDisplay();
    saveState();
}

function toggleHandles() {
    const showAll = showHandlesToggle.checked;
    document.querySelectorAll('.placed-image, .poster-block').forEach(el => {
        const isSelected = el.classList.contains('selected');
        el.querySelectorAll('.resize-handle').forEach(handle => {
            handle.style.display = (showAll || isSelected) ? 'block' : 'none';
        });
    });
    saveState();
}

function updateHandlesVisibility() {
    const showAll = showHandlesToggle.checked;
    document.querySelectorAll('.placed-image, .poster-block').forEach(el => {
        const isSelected = el.classList.contains('selected');
        el.querySelectorAll('.resize-handle').forEach(handle => {
            handle.style.display = (showAll || isSelected) ? 'block' : 'none';
        });
    });
}
wallPreset.addEventListener('change', () => {
    updateWallGuide(true);
    saveState();
});
moveOutOfGuide.addEventListener('click', moveImagesOutOfGuide);
clearCanvasBtn.addEventListener('click', clearCanvas);
removeUploadedBtn.addEventListener('click', removeUploadedImages);
add18x24Btn.addEventListener('click', () => addPosterBlock(18, 24));
add24x36Btn.addEventListener('click', () => addPosterBlock(24, 36));

function addPosterBlock(widthIn, heightIn) {
    const widthPx = widthIn * DPI;
    const heightPx = heightIn * DPI;
    
    const blockData = {
        id: `block-${Date.now()}-${Math.random()}`,
        type: 'block',
        name: `${widthIn}" × ${heightIn}"`,
        width: widthPx,
        height: heightPx,
        maxWidth: widthPx,
        maxHeight: heightPx,
        x: 50,
        y: 50
    };
    
    placedImages.push(blockData);
    renderPosterBlock(blockData);
    saveState();
}

function renderPosterBlock(blockData) {
    const container = document.createElement('div');
    container.className = 'poster-block';
    container.id = blockData.id;
    
    container.style.left = `${toVisual(blockData.x)}px`;
    container.style.top = `${toVisual(blockData.y)}px`;
    container.style.width = `${toVisual(blockData.width)}px`;
    container.style.height = `${toVisual(blockData.height)}px`;
    
    // Add label span so we can add marker
    const label = document.createElement('span');
    label.textContent = blockData.name;
    container.appendChild(label);
    
    // Add large marker if bigger than letter paper
    if (isLargerThanLetter(blockData.width, blockData.height)) {
        const marker = document.createElement('div');
        marker.className = 'large-marker';
        marker.textContent = 'L';
        marker.title = 'Larger than 8.5" × 11"';
        container.appendChild(marker);
    }
    
    // Resize handles
    const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    handles.forEach(position => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${position}`;
        handle.addEventListener('mousedown', (e) => startResize(e, blockData.id, position));
        container.appendChild(handle);
    });
    
    container.addEventListener('mousedown', (e) => {
        if (!e.target.classList.contains('resize-handle')) {
            startDrag(e, blockData.id);
        }
    });
    
    mainArea.appendChild(container);
}

function toggleLabels() {
    const show = showLabelsToggle.checked;
    document.querySelectorAll('.image-info').forEach(el => {
        el.style.display = show ? 'flex' : 'none';
    });
    saveState();
}

// Wall guide offset in real pixels (consistent position)
const WALL_GUIDE_OFFSET = 20;

function getWallGuideRealDimensions() {
    const preset = WALL_PRESETS[wallPreset.value];
    if (!preset) return null;
    return {
        x: WALL_GUIDE_OFFSET,
        y: WALL_GUIDE_OFFSET,
        width: preset.width * DPI,
        height: preset.height * DPI
    };
}

function updateWallGuide(moveImages = false) {
    // Remove existing guide
    const existingGuide = document.getElementById('wallGuide');
    if (existingGuide) existingGuide.remove();
    
    const preset = WALL_PRESETS[wallPreset.value];
    if (!preset) return;
    
    // Convert inches to pixels
    const widthPx = preset.width * DPI;
    const heightPx = preset.height * DPI;
    
    // Create wall guide element
    const guide = document.createElement('div');
    guide.id = 'wallGuide';
    guide.className = 'wall-guide';
    
    guide.style.left = `${toVisual(WALL_GUIDE_OFFSET)}px`;
    guide.style.top = `${toVisual(WALL_GUIDE_OFFSET)}px`;
    guide.style.width = `${toVisual(widthPx)}px`;
    guide.style.height = `${toVisual(heightPx)}px`;
    
    const label = document.createElement('div');
    label.className = 'wall-guide-label';
    label.textContent = `${preset.name}: ${preset.width}" × ${preset.height}"`;
    guide.appendChild(label);
    
    mainArea.appendChild(guide);
    
    // Move images inside the wall guide if requested
    if (moveImages && placedImages.length > 0) {
        moveImagesToWallGuide();
    }
}

function moveImagesToWallGuide() {
    const guide = getWallGuideRealDimensions();
    if (!guide) return;
    
    const PADDING = 20;
    let currentX = guide.x + PADDING;
    let currentY = guide.y + PADDING;
    let rowHeight = 0;
    const maxX = guide.x + guide.width - PADDING;
    
    placedImages.forEach(img => {
        // Check if image fits in current row
        if (currentX + img.width > maxX && currentX !== guide.x + PADDING) {
            // Move to next row
            currentX = guide.x + PADDING;
            currentY += rowHeight + PADDING;
            rowHeight = 0;
        }
        
        // Update image position
        img.x = currentX;
        img.y = currentY;
        
        // Update DOM
        const element = document.getElementById(img.id);
        if (element) {
            element.style.left = `${toVisual(img.x)}px`;
            element.style.top = `${toVisual(img.y)}px`;
        }
        
        currentX += img.width + PADDING;
        rowHeight = Math.max(rowHeight, img.height);
    });
    
    updateCurrentSizeDisplay();
    saveState();
}

function moveImagesOutOfGuide() {
    const guide = getWallGuideRealDimensions();
    if (!guide || placedImages.length === 0) return;
    
    const PADDING = 20;
    const startY = guide.y + guide.height + PADDING; // Start below the guide
    let currentX = guide.x;
    let currentY = startY;
    let rowHeight = 0;
    const maxX = guide.x + guide.width;
    
    placedImages.forEach(img => {
        // Check if image fits in current row
        if (currentX + img.width > maxX && currentX !== guide.x) {
            // Move to next row
            currentX = guide.x;
            currentY += rowHeight + PADDING;
            rowHeight = 0;
        }
        
        // Update image position
        img.x = currentX;
        img.y = currentY;
        
        // Update DOM
        const element = document.getElementById(img.id);
        if (element) {
            element.style.left = `${toVisual(img.x)}px`;
            element.style.top = `${toVisual(img.y)}px`;
        }
        
        currentX += img.width + PADDING;
        rowHeight = Math.max(rowHeight, img.height);
    });
    
    updateCurrentSizeDisplay();
    saveState();
}

// Update wall guide when zoom changes
function updateAllVisuals() {
    placedImages.forEach(img => {
        const element = document.getElementById(img.id);
        if (element) {
            element.style.left = `${toVisual(img.x)}px`;
            element.style.top = `${toVisual(img.y)}px`;
            element.style.width = `${toVisual(img.width)}px`;
            element.style.height = `${toVisual(img.height)}px`;
        }
    });
    
    // Also update wall guide (without moving images)
    updateWallGuide(false);
}

// Check if an item is a block
function isBlock(item) {
    return item.type === 'block';
}

function updateCurrentSizeDisplay() {
    if (placedImages.length === 0) {
        currentSizeDisplay.innerHTML = 'Current: — in × — in<br>&emsp;&emsp;&emsp;&ensp;(— ft × — ft)';
        return;
    }
    
    // Calculate total canvas bounds
    let maxRight = 0;
    let maxBottom = 0;
    
    placedImages.forEach(img => {
        const right = img.x + img.width;
        const bottom = img.y + img.height;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    });
    
    const widthIn = (maxRight / DPI).toFixed(1);
    const heightIn = (maxBottom / DPI).toFixed(1);
    const widthFt = (maxRight / DPI / 12).toFixed(1);
    const heightFt = (maxBottom / DPI / 12).toFixed(1);
    currentSizeDisplay.innerHTML = `Current: ${widthIn} in × ${heightIn} in<br>&emsp;&emsp;&emsp;&ensp;(${widthFt} ft × ${heightFt} ft)`;
}

function placeAllImages() {
    const PADDING = 20; // Space between images (in visual pixels)
    const START_X = 30;
    const START_Y = 30;
    
    const mainRect = mainArea.getBoundingClientRect();
    const availableWidth = mainRect.width - 60;
    const availableHeight = mainRect.height - 100;
    
    // Get images that need to be placed
    const imagesToPlace = uploadedImages.filter(img => 
        !placedImages.some(p => p.sourceId === img.id)
    );
    
    if (imagesToPlace.length === 0) return;
    
    // Sort by area (smallest to largest)
    imagesToPlace.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    
    // Calculate total area of all images
    let totalArea = 0;
    imagesToPlace.forEach(img => {
        totalArea += img.width * img.height;
    });
    
    // Calculate target area (viewport area)
    const targetArea = availableWidth * availableHeight;
    
    // Calculate scale factor to fit all images
    // Use sqrt because area scales with square of linear dimension
    let scale = Math.sqrt(targetArea / totalArea) * 0.7; // 0.7 for padding buffer
    scale = Math.min(scale, 1); // Don't scale up
    
    // Set the canvas zoom
    canvasZoom = scale;
    
    // Now place images in a grid using real coordinates
    let currentX = START_X / scale;
    let currentY = START_Y / scale;
    let rowHeight = 0;
    const maxRealWidth = availableWidth / scale;
    const realPadding = PADDING / scale;
    
    imagesToPlace.forEach(imageData => {
        // Check if image fits in current row
        if (currentX + imageData.width > maxRealWidth && currentX !== START_X / scale) {
            // Move to next row
            currentX = START_X / scale;
            currentY += rowHeight + realPadding;
            rowHeight = 0;
        }
        
        // Place image at current position
        addImageToMainAreaAt(imageData, currentX, currentY);
        
        // Update position for next image
        currentX += imageData.width + realPadding;
        rowHeight = Math.max(rowHeight, imageData.height);
    });
    
    // Update all visuals with the new zoom
    updateAllVisuals();
}

function addImageToMainAreaAt(imageData, x, y) {
    const placedImageData = {
        id: `placed-${Date.now()}-${Math.random()}`,
        sourceId: imageData.id,
        name: imageData.name,
        src: imageData.src,
        maxWidth: imageData.width,
        maxHeight: imageData.height,
        width: imageData.width,
        height: imageData.height,
        x: x,
        y: y
    };
    
    placedImages.push(placedImageData);
    renderPlacedImage(placedImageData);
    updateCurrentSizeDisplay();
    saveState();
}

// Load default layout from JSON file
async function loadDefaultLayout() {
    try {
        const response = await fetch('default-layout.json');
        if (response.ok) {
            const layoutJson = await response.text();
            return JSON.parse(layoutJson);
        }
    } catch (e) {
        console.log('No default layout found');
    }
    return null;
}

// Preload images from Posters folder on page load
window.addEventListener('load', async () => {
    const savedState = loadState();
    await preloadPosterImages();
    
    // Restore state: prefer localStorage, fall back to default layout
    if (savedState) {
        restoreState(savedState);
    } else {
        const defaultLayout = await loadDefaultLayout();
        if (defaultLayout) {
            lastSavedState = JSON.stringify(defaultLayout); // Initialize for undo
            restoreState(defaultLayout);
        }
    }
});

const MAX_PREVIEW_SIZE = 800; // Max dimension for preview images

// Create a lower-quality preview of an image for better performance
function createPreview(img, maxSize) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let width = img.width;
    let height = img.height;
    
    // Only downscale if larger than maxSize
    if (width > maxSize || height > maxSize) {
        const scale = Math.min(maxSize / width, maxSize / height);
        width = Math.floor(width * scale);
        height = Math.floor(height * scale);
    }
    
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    
    return canvas.toDataURL('image/jpeg', 0.7); // 70% quality JPEG
}

async function preloadPosterImages() {
    let posterFiles = [];
    
    try {
        const response = await fetch('posters.json');
        posterFiles = await response.json();
    } catch (error) {
        console.error('Could not load posters.json:', error);
        return;
    }
    
    // Sort alphabetically
    posterFiles.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    
    // Load all images and wait for them to complete
    const loadPromises = posterFiles.map(fileName => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = function() {
                const previewSrc = createPreview(img, MAX_PREVIEW_SIZE);
                const imageData = {
                    id: imageIdCounter++,
                    name: fileName,
                    src: previewSrc,
                    thumbSrc: previewSrc,
                    width: img.width,
                    height: img.height,
                    isFromPosters: true  // Mark as from Posters folder
                };
                uploadedImages.push(imageData);
                resolve(imageData);
            };
            img.onerror = function() {
                console.error('Failed to load:', fileName);
                resolve(null);
            };
            img.src = `Posters/${fileName}`;
        });
    });
    
    // Wait for all images to load
    await Promise.all(loadPromises);
    
    // Sort uploadedImages alphabetically and add to sidebar in order
    uploadedImages.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    uploadedImages.forEach(imageData => {
        if (imageData) {
            addImageToSidebar(imageData);
        }
    });
}

function handleFileUpload(event) {
    const files = event.target.files;
    
    for (let file of files) {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const previewSrc = createPreview(img, MAX_PREVIEW_SIZE);
                    const imageData = {
                        id: imageIdCounter++,
                        name: file.name,
                        src: previewSrc,           // Use preview for display
                        thumbSrc: previewSrc,      // Thumbnail for sidebar
                        width: img.width,          // Original dimensions for calculations
                        height: img.height,
                        isFromPosters: false       // Mark as uploaded, not from Posters folder
                    };
                    uploadedImages.push(imageData);
                    addImageToSidebar(imageData);
                };
                img.src = e.target.result;
            };
            
            reader.readAsDataURL(file);
        }
    }
    
    // Reset input
    fileInput.value = '';
}

function addImageToSidebar(imageData) {
    const posterSize = calculatePosterSize(imageData.width, imageData.height);
    
    const item = document.createElement('div');
    item.className = 'image-item';
    item.dataset.name = imageData.name.toLowerCase(); // For sorting
    item.innerHTML = `
        <img src="${imageData.src}" alt="${imageData.name}" class="image-item-thumbnail">
        <div class="image-item-info">
            <div class="image-item-name">${imageData.name}</div>
            <div class="image-item-dimensions">${imageData.width} × ${imageData.height}px</div>
            <div class="image-item-dimensions">${posterSize}</div>
        </div>
    `;
    
    item.addEventListener('click', () => addImageToMainArea(imageData));
    
    // Insert in alphabetical order
    const existingItems = Array.from(imageList.querySelectorAll('.image-item'));
    const insertIndex = existingItems.findIndex(existing => 
        existing.dataset.name.localeCompare(item.dataset.name) > 0
    );
    
    if (insertIndex === -1) {
        imageList.appendChild(item);
    } else {
        imageList.insertBefore(item, existingItems[insertIndex]);
    }
    
    // Remove placeholder if it exists
    const placeholder = mainArea.querySelector('.placeholder');
    if (placeholder && uploadedImages.length >= 1) {
        placeholder.style.display = 'none';
    }
}

function calculatePosterSize(widthPx, heightPx) {
    const widthIn = (widthPx / DPI).toFixed(1);
    const heightIn = (heightPx / DPI).toFixed(1);
    return `${widthIn}" × ${heightIn}"`;
}

function addImageToMainArea(imageData) {
    // Place images at max size (real dimensions)
    const placedImageData = {
        id: `placed-${Date.now()}-${Math.random()}`,
        sourceId: imageData.id,
        name: imageData.name,
        src: imageData.src,
        maxWidth: imageData.width,
        maxHeight: imageData.height,
        width: imageData.width,      // Real width (for inch calculation)
        height: imageData.height,    // Real height (for inch calculation)
        x: 50,                       // Real x position
        y: 50                        // Real y position
    };
    
    placedImages.push(placedImageData);
    renderPlacedImage(placedImageData);
    saveState();
}

// Convert real coordinates to visual (zoomed) coordinates
function toVisual(value) {
    return value * canvasZoom;
}

// Convert visual (zoomed) coordinates to real coordinates
function toReal(value) {
    return value / canvasZoom;
}

function renderPlacedImage(placedImageData) {
    const container = document.createElement('div');
    container.className = 'placed-image';
    container.id = placedImageData.id;
    
    // Apply visual (zoomed) positioning and size
    container.style.left = `${toVisual(placedImageData.x)}px`;
    container.style.top = `${toVisual(placedImageData.y)}px`;
    container.style.width = `${toVisual(placedImageData.width)}px`;
    container.style.height = `${toVisual(placedImageData.height)}px`;
    
    const img = document.createElement('img');
    img.src = placedImageData.src;
    
    const info = document.createElement('div');
    info.className = 'image-info';
    // Info shows REAL dimensions (not affected by zoom)
    info.innerHTML = `
        <div class="image-info-text">
            ${placedImageData.width.toFixed(0)} × ${placedImageData.height.toFixed(0)}px<br>
            ${calculatePosterSize(placedImageData.width, placedImageData.height)}
        </div>
        <button class="max-button">MAX</button>
    `;
    
    // Add click handler for MAX button
    const maxButton = info.querySelector('.max-button');
    maxButton.addEventListener('click', (e) => {
        e.stopPropagation();
        resizeToMax(placedImageData.id);
    });
    
    // Resize handles
    const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    handles.forEach(position => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${position}`;
        handle.addEventListener('mousedown', (e) => startResize(e, placedImageData.id, position));
        container.appendChild(handle);
    });
    
    // Add large marker if bigger than letter paper
    if (isLargerThanLetter(placedImageData.width, placedImageData.height)) {
        const marker = document.createElement('div');
        marker.className = 'large-marker';
        marker.textContent = 'L';
        marker.title = 'Larger than 8.5" × 11"';
        container.appendChild(marker);
    }
    
    container.appendChild(img);
    container.appendChild(info);
    
    container.addEventListener('mousedown', (e) => {
        if (!e.target.classList.contains('resize-handle')) {
            startDrag(e, placedImageData.id);
        }
    });
    
    mainArea.appendChild(container);
}

// This function is now defined above with wall guide support

function startDrag(event, imageId) {
    if (event.button !== 0) return; // Only left click
    
    event.preventDefault();
    isDragging = true;
    
    // If clicking on an already selected image (in multi-select), keep selection
    // Otherwise, select this image (add to selection if shift is held)
    if (!selectedImages.includes(imageId)) {
        selectImage(imageId, event.shiftKey);
    }
    selectedImage = imageId;
    
    const element = document.getElementById(imageId);
    const rect = element.getBoundingClientRect();
    
    // Store offset in visual coordinates
    dragOffset.x = event.clientX - rect.left;
    dragOffset.y = event.clientY - rect.top;
    
    // Update current size display
    updateCurrentSizeDisplay();
}

function startResize(event, imageId, position) {
    event.preventDefault();
    event.stopPropagation();
    
    isResizing = true;
    selectedImage = imageId;
    
    const element = document.getElementById(imageId);
    element.classList.add('selected');
    
    const imageData = placedImages.find(img => img.id === imageId);
    
    resizeData = {
        imageId,
        position,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: imageData.width,      // Real dimensions
        startHeight: imageData.height,
        startPosX: imageData.x,           // Real position
        startPosY: imageData.y,
        aspectRatio: imageData.width / imageData.height,
        maxWidth: imageData.maxWidth,
        maxHeight: imageData.maxHeight
    };
}

document.addEventListener('mousemove', (event) => {
    // Handle marquee selection
    if (isMarqueeSelecting && marqueeData) {
        const mainRect = mainArea.getBoundingClientRect();
        marqueeData.currentX = event.clientX - mainRect.left + mainArea.scrollLeft;
        marqueeData.currentY = event.clientY - mainRect.top + mainArea.scrollTop;
        
        const rect = document.getElementById('selectionRect');
        if (rect) {
            const left = Math.min(marqueeData.startX, marqueeData.currentX);
            const top = Math.min(marqueeData.startY, marqueeData.currentY);
            const width = Math.abs(marqueeData.currentX - marqueeData.startX);
            const height = Math.abs(marqueeData.currentY - marqueeData.startY);
            
            rect.style.left = `${left}px`;
            rect.style.top = `${top}px`;
            rect.style.width = `${width}px`;
            rect.style.height = `${height}px`;
        }
        return;
    }
    
    if (isDragging && selectedImage) {
        const mainRect = mainArea.getBoundingClientRect();
        const imageData = placedImages.find(img => img.id === selectedImage);
        
        // Calculate new visual position, then convert to real
        let visualX = event.clientX - mainRect.left - dragOffset.x + mainArea.scrollLeft;
        let visualY = event.clientY - mainRect.top - dragOffset.y + mainArea.scrollTop;
        
        // Convert to real coordinates
        let newX = toReal(visualX);
        let newY = toReal(visualY);
        
        // Keep within bounds
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);
        
        // Calculate delta from original position
        const deltaX = newX - imageData.x;
        const deltaY = newY - imageData.y;
        
        // Move all selected images by the same delta
        if (selectedImages.length > 1 && selectedImages.includes(selectedImage)) {
            selectedImages.forEach(imgId => {
                const img = placedImages.find(i => i.id === imgId);
                if (img) {
                    img.x = Math.max(0, img.x + deltaX);
                    img.y = Math.max(0, img.y + deltaY);
                    
                    const el = document.getElementById(imgId);
                    if (el) {
                        el.style.left = `${toVisual(img.x)}px`;
                        el.style.top = `${toVisual(img.y)}px`;
                    }
                }
            });
        } else {
            // Single image drag
            imageData.x = newX;
            imageData.y = newY;
            
            const element = document.getElementById(selectedImage);
            element.style.left = `${toVisual(newX)}px`;
            element.style.top = `${toVisual(newY)}px`;
        }
        
        updateCurrentSizeDisplay();
    }
    
    if (isResizing && resizeData) {
        // Mouse delta in visual pixels, convert to real
        const dx = toReal(event.clientX - resizeData.startX);
        const dy = toReal(event.clientY - resizeData.startY);
        
        let newWidth, newHeight, newX, newY;
        
        const position = resizeData.position;
        
        if (position === 'bottom-right') {
            newWidth = resizeData.startWidth + dx;
            newHeight = newWidth / resizeData.aspectRatio;
            newX = resizeData.startPosX;
            newY = resizeData.startPosY;
        } else if (position === 'bottom-left') {
            newWidth = resizeData.startWidth - dx;
            newHeight = newWidth / resizeData.aspectRatio;
            newX = resizeData.startPosX + dx;
            newY = resizeData.startPosY;
        } else if (position === 'top-right') {
            newWidth = resizeData.startWidth + dx;
            newHeight = newWidth / resizeData.aspectRatio;
            newX = resizeData.startPosX;
            newY = resizeData.startPosY + (resizeData.startHeight - newHeight);
        } else if (position === 'top-left') {
            newWidth = resizeData.startWidth - dx;
            newHeight = newWidth / resizeData.aspectRatio;
            newX = resizeData.startPosX + dx;
            newY = resizeData.startPosY + (resizeData.startHeight - newHeight);
        }
        
        // Enforce minimum size (in real pixels)
        if (newWidth < 50 || newHeight < 50) {
            return;
        }
        
        const imageData = placedImages.find(img => img.id === resizeData.imageId);
        const element = document.getElementById(resizeData.imageId);
        
        // Check if over max size and apply/remove class
        if (newWidth > resizeData.maxWidth || newHeight > resizeData.maxHeight) {
            element.classList.add('over-max');
        } else {
            element.classList.remove('over-max');
        }
        
        imageData.width = newWidth;
        imageData.height = newHeight;
        imageData.x = newX;
        imageData.y = newY;
        
        element.style.width = `${toVisual(newWidth)}px`;
        element.style.height = `${toVisual(newHeight)}px`;
        element.style.left = `${toVisual(newX)}px`;
        element.style.top = `${toVisual(newY)}px`;
        
        // Update info display (shows REAL dimensions)
        updateImageInfo(element, newWidth, newHeight);
        updateCurrentSizeDisplay();
    }
});

function updateImageInfo(element, width, height) {
    const infoText = element.querySelector('.image-info-text');
    if (infoText) {
        // Update large marker
        let marker = element.querySelector('.large-marker');
        if (isLargerThanLetter(width, height)) {
            if (!marker) {
                marker = document.createElement('div');
                marker.className = 'large-marker';
                marker.textContent = 'L';
                marker.title = 'Larger than 8.5" × 11"';
                element.insertBefore(marker, element.firstChild);
            }
        } else if (marker) {
            marker.remove();
        }
        infoText.innerHTML = `
            ${width.toFixed(0)} × ${height.toFixed(0)}px<br>
            ${calculatePosterSize(width, height)}
        `;
    }
}

function resizeToMax(imageId) {
    const imageData = placedImages.find(img => img.id === imageId);
    if (!imageData) return;
    
    imageData.width = imageData.maxWidth;
    imageData.height = imageData.maxHeight;
    
    const element = document.getElementById(imageId);
    element.style.width = `${toVisual(imageData.width)}px`;
    element.style.height = `${toVisual(imageData.height)}px`;
    element.classList.remove('over-max');
    
    updateImageInfo(element, imageData.width, imageData.height);
}

function deleteSelectedImage() {
    if (selectedImages.length === 0 && !selectedImage) return;
    
    // Delete all selected images
    const imagesToDelete = selectedImages.length > 0 ? [...selectedImages] : [selectedImage];
    
    imagesToDelete.forEach(imgId => {
        const element = document.getElementById(imgId);
        if (element) {
            element.remove();
        }
        
        // Remove from placedImages array
        const index = placedImages.findIndex(img => img.id === imgId);
        if (index !== -1) {
            placedImages.splice(index, 1);
        }
    });
    
    selectedImage = null;
    selectedImages = [];
    updateCurrentSizeDisplay();
    saveState();
}

// Keyboard event handler for Delete and Undo
document.addEventListener('keydown', (event) => {
    // Delete selected images
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedImage) {
        event.preventDefault();
        deleteSelectedImage();
    }
    
    // Undo: Ctrl+Z or Cmd+Z
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        undo();
    }
});

// Resize canvas to fit all images (zoom out view)
function resizeCanvasToFit() {
    // Get main area dimensions
    const mainRect = mainArea.getBoundingClientRect();
    const availableWidth = mainRect.width - 100; // Leave padding
    const availableHeight = mainRect.height - 150; // Leave padding + space for info boxes
    
    // Calculate bounds of all images (in real pixels)
    let maxRight = 0;
    let maxBottom = 0;
    
    placedImages.forEach(img => {
        const right = img.x + img.width;
        const bottom = img.y + img.height;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    });
    
    // Include wall guide in calculations if active
    const guide = getWallGuideRealDimensions();
    if (guide) {
        const guideRight = guide.x + guide.width;
        const guideBottom = guide.y + guide.height;
        if (guideRight > maxRight) maxRight = guideRight;
        if (guideBottom > maxBottom) maxBottom = guideBottom;
    }
    
    // If nothing to show, return
    if (maxRight === 0 && maxBottom === 0) return;
    
    // Calculate zoom level needed to fit everything
    const scaleX = availableWidth / maxRight;
    const scaleY = availableHeight / maxBottom;
    canvasZoom = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%, only out
    
    // Apply zoom to all images
    updateAllVisuals();
    saveState();
}

document.addEventListener('mouseup', () => {
    // Handle marquee selection end
    if (isMarqueeSelecting && marqueeData) {
        const matchingImages = getImagesInRect(
            marqueeData.startX,
            marqueeData.startY,
            marqueeData.currentX,
            marqueeData.currentY
        );
        
        matchingImages.forEach(imgId => {
            selectImage(imgId, true);
        });
        
        // Remove selection rectangle
        const rect = document.getElementById('selectionRect');
        if (rect) rect.remove();
        
        isMarqueeSelecting = false;
        marqueeData = null;
    }
    
    // Save state if we were dragging or resizing
    if (isDragging || isResizing) {
        saveState();
    }
    
    isDragging = false;
    isResizing = false;
    resizeData = null;
});

// Marquee selection - start
mainArea.addEventListener('mousedown', (event) => {
    if (event.target === mainArea || event.target.classList.contains('placeholder') || event.target.id === 'wallGuide') {
        // Start marquee selection
        const mainRect = mainArea.getBoundingClientRect();
        const startX = event.clientX - mainRect.left + mainArea.scrollLeft;
        const startY = event.clientY - mainRect.top + mainArea.scrollTop;
        
        isMarqueeSelecting = true;
        marqueeData = {
            startX,
            startY,
            currentX: startX,
            currentY: startY
        };
        
        // Create selection rectangle
        const rect = document.createElement('div');
        rect.id = 'selectionRect';
        rect.className = 'selection-rect';
        rect.style.left = `${startX}px`;
        rect.style.top = `${startY}px`;
        rect.style.width = '0px';
        rect.style.height = '0px';
        mainArea.appendChild(rect);
        
        // Clear previous selection if not holding shift
        if (!event.shiftKey) {
            deselectAll();
        }
    }
});

function deselectAll() {
    document.querySelectorAll('.placed-image, .poster-block').forEach(el => {
        el.classList.remove('selected');
    });
    selectedImage = null;
    selectedImages = [];
    updateCurrentSizeDisplay();
    updateHandlesVisibility();
}

function selectImage(imageId, addToSelection = false) {
    if (!addToSelection) {
        deselectAll();
    }
    
    const element = document.getElementById(imageId);
    if (element) {
        element.classList.add('selected');
    }
    
    if (!selectedImages.includes(imageId)) {
        selectedImages.push(imageId);
    }
    selectedImage = imageId;
    updateHandlesVisibility();
}

function getImagesInRect(x1, y1, x2, y2) {
    // Normalize coordinates
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    
    const matchingImages = [];
    
    placedImages.forEach(img => {
        // Convert to visual coordinates for comparison
        const imgLeft = toVisual(img.x);
        const imgTop = toVisual(img.y);
        const imgRight = imgLeft + toVisual(img.width);
        const imgBottom = imgTop + toVisual(img.height);
        
        // Check if rectangles intersect
        if (imgLeft < right && imgRight > left && imgTop < bottom && imgBottom > top) {
            matchingImages.push(img.id);
        }
    });
    
    return matchingImages;
}
