"""Builds src/data/generic-foods.json from foods.tsv and the USDA SR Legacy CSV download.

Usage: python3 scripts/generic-foods/build.py <folder with food.csv and food_nutrient.csv>
Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'src', 'data', 'generic-foods.json')

NUTRIENTS = {
    '1008': 'kcal',
    '1003': 'protein',
    '1005': 'carbs_by_difference',
    '1004': 'fat',
    '2000': 'sugars',
    '1079': 'fiber',
    '1258': 'satFat',
    '1093': 'sodium_mg',
}


def read_entries():
    entries = []
    with open(os.path.join(HERE, 'foods.tsv'), encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            cols = line.split('\t')
            cols += [''] * (6 - len(cols))
            fdc_id, name, category, unit, serving, label = cols[:6]
            entries.append({
                'fdc_id': fdc_id,
                'name': name,
                'category': category,
                'unit': unit,
                'serving': float(serving) if serving else None,
                'label': label or None,
            })
    return entries


def read_nutrients(folder, ids):
    values = {i: {} for i in ids}
    with open(os.path.join(folder, 'food_nutrient.csv'), newline='') as f:
        for row in csv.DictReader(f):
            key = NUTRIENTS.get(row['nutrient_id'])
            if key and row['fdc_id'] in values:
                values[row['fdc_id']][key] = float(row['amount'])
    return values


def round2(x):
    return None if x is None else round(x, 2)


def main(folder):
    entries = read_entries()
    ids = [e['fdc_id'] for e in entries]
    assert len(ids) == len(set(ids)), 'duplicate fdc_id in foods.tsv'
    names = [e['name'] for e in entries]
    assert len(names) == len(set(names)), 'duplicate name in foods.tsv'
    nutrients = read_nutrients(folder, ids)

    foods = []
    for e in entries:
        n = nutrients[e['fdc_id']]
        assert 'kcal' in n, f"{e['name']}: no energy value in USDA data"
        fiber = n.get('fiber')
        sugars = n.get('sugars')
        # USDA carbohydrate includes fibre; EU labels (and Open Food Facts) do not.
        carbs = max(0.0, n.get('carbs_by_difference', 0.0) - (fiber or 0.0))
        if sugars is not None:
            carbs = max(carbs, sugars)
        sodium = n.get('sodium_mg')
        foods.append({
            'ref': f"usda:{e['fdc_id']}",
            'name': e['name'],
            'category': e['category'],
            'unit': e['unit'],
            'per100': {
                'kcal': round2(n['kcal']),
                'protein': round2(n.get('protein', 0.0)),
                'carbs': round2(carbs),
                'fat': round2(n.get('fat', 0.0)),
                'sugars': round2(sugars),
                'fiber': round2(fiber),
                'satFat': round2(n.get('satFat')),
                'salt': None if sodium is None else round(sodium * 2.5 / 1000, 3),
            },
            'servingSize': e['serving'],
            'servingLabel': e['label'],
        })

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(foods, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(foods)} foods → {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main(sys.argv[1])
