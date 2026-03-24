import os
import io
import base64
import numpy as np
import cv2
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'tiff', 'bmp', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def compute_water_index(image):
    B = image[:, :, 0].astype(float)
    G = image[:, :, 1].astype(float)
    R = image[:, :, 2].astype(float)
    wi = (B - R) / (B + R + 1e-10)
    wi_norm = ((wi - wi.min()) / (wi.max() - wi.min() + 1e-10) * 255)
    return wi_norm.astype(np.uint8)


def compute_texture_map(gray, ksize=5):
    mean = cv2.blur(gray.astype(float), (ksize, ksize))
    sq_mean = cv2.blur((gray.astype(float)) ** 2, (ksize, ksize))
    variance = sq_mean - mean ** 2
    variance_norm = ((variance - variance.min()) / (variance.max() - variance.min() + 1e-10) * 255)
    return variance_norm.astype(np.uint8)


def water_fitness(wi, texture, thresholds):
    T_wi, T_tex = thresholds
    mask = (wi > T_wi) & (texture < T_tex)
    if np.sum(mask) == 0:
        return 0
    water_pixels = wi[mask]
    non_water_pixels = wi[~mask]
    if len(water_pixels) == 0 or len(non_water_pixels) == 0:
        return 0
    mu_water = np.mean(water_pixels)
    mu_non_water = np.mean(non_water_pixels)
    omega_water = len(water_pixels) / wi.size
    omega_non_water = len(non_water_pixels) / wi.size
    mu_total = omega_water * mu_water + omega_non_water * mu_non_water
    between_var = (
        omega_water * (mu_water - mu_total) ** 2 +
        omega_non_water * (mu_non_water - mu_total) ** 2
    )
    mask_uint = mask.astype(np.uint8)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask_uint)
    largest_component = 0
    component_areas = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        component_areas.append(area)
        largest_component = max(largest_component, area)
    spatial_score = largest_component / (wi.shape[0] * wi.shape[1])
    if len(component_areas) > 0:
        small_components = [a for a in component_areas if a < 200]
        fragmentation_penalty = len(small_components) / wi.size
    else:
        fragmentation_penalty = 0
    fitness = between_var + 500 * spatial_score - 300 * fragmentation_penalty
    return fitness


def ACS_2D(wi, texture, n_nests=25, n_iter=50, pa=0.25):
    nests = np.random.randint(1, 255, (n_nests, 2))
    fitness = np.array([water_fitness(wi, texture, nest) for nest in nests])
    for t in range(1, n_iter + 1):
        best = np.max(fitness)
        worst = np.min(fitness)
        for i in range(n_nests):
            step = (1 / t) * abs((best - fitness[i]) / (best - worst + 1e-10))
            new_nest = nests[i] + np.random.randn(2) * step * 50
            new_nest = np.clip(new_nest, 1, 254).astype(int)
            new_fitness = water_fitness(wi, texture, new_nest)
            if new_fitness > fitness[i]:
                nests[i] = new_nest
                fitness[i] = new_fitness
        pa_dynamic = pa * (1 - t / n_iter)
        abandon = np.random.rand(n_nests) < pa_dynamic
        nests[abandon] = np.random.randint(1, 255, (np.sum(abandon), 2))
        fitness[abandon] = np.array([water_fitness(wi, texture, nest) for nest in nests[abandon]])
    best_index = np.argmax(fitness)
    return nests[best_index]


def post_process(mask):
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] < 500:
            mask[labels == i] = 0
    return mask


def array_to_b64(arr, cmap=None):
    fig, ax = plt.subplots(figsize=(6, 6))
    if cmap:
        ax.imshow(arr, cmap=cmap)
    else:
        ax.imshow(arr)
    ax.axis('off')
    plt.tight_layout(pad=0)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


def compute_stats(image, water_mask):
    h, w = image.shape[:2]
    total_pixels = h * w
    water_pixels = int(np.sum(water_mask > 0))
    water_pct = round((water_pixels / total_pixels) * 100, 2)
    pixel_area_m2 = 100
    estimated_area_km2 = round((water_pixels * pixel_area_m2) / 1e6, 4)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(water_mask.astype(np.uint8))
    num_bodies = max(0, num_labels - 1)
    contours, _ = cv2.findContours(water_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    perimeter = sum(cv2.arcLength(c, True) for c in contours)

    return {
        "total_pixels": total_pixels,
        "water_pixels": water_pixels,
        "water_coverage": water_pct,
        "estimated_area_km2": estimated_area_km2,
        "num_water_bodies": num_bodies,
        "perimeter_px": round(perimeter, 1),
        "image_dimensions": f"{w} × {h} px"
    }


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'static'), filename)


@app.route('/segment', methods=['POST'])
def segment():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Unsupported file type. Use PNG, JPG, TIFF, or BMP.'}), 400

    file_bytes = np.frombuffer(file.read(), np.uint8)
    img_bgr = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return jsonify({'error': 'Could not decode image'}), 400

    image = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    n_nests = int(request.form.get('n_nests', 25))
    n_iter = int(request.form.get('n_iter', 50))
    pa = float(request.form.get('pa', 0.25))

    wi = compute_water_index(image)
    texture = compute_texture_map(gray)
    best_thresholds = ACS_2D(wi, texture, n_nests=n_nests, n_iter=n_iter, pa=pa)
    T_wi, T_tex = best_thresholds
    water_mask = (wi > T_wi) & (texture < T_tex)
    water_mask = post_process(water_mask)

    overlay = image.copy()
    overlay[water_mask > 0] = (overlay[water_mask > 0] * 0.4 + np.array([0, 120, 220]) * 0.6).clip(0, 255).astype(np.uint8)

    stats = compute_stats(image, water_mask)
    stats['optimal_thresholds'] = {'water_index': int(T_wi), 'texture': int(T_tex)}

    return jsonify({
        'original': array_to_b64(image),
        'water_index': array_to_b64(wi, cmap='Blues'),
        'water_mask': array_to_b64(water_mask, cmap='Greens'),
        'overlay': array_to_b64(overlay),
        'stats': stats
    })


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
