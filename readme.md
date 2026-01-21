# Shaped Plate Inset Border Creator

This script scans a directory of SVG shaped plate files and, for each one, creates a new equidistant inset border `<path>` element with `id="border"`.

## Requirements

* Node.js 18+
* SVG files must contain a single closed path with `id="plate"`.

## Usage

```bash
node createBorder.js <directory>
```

* `<directory>`: Path to the folder containing `.svg` files. (If not specified it will assume there is a folder in the script's containing directory called `svgs`.)

### Example

```bash
node createBorder.js ./svgs
```
Or

```bash
node createBorder.js
```

This will:

* Loop through all `.svg` files in `./svgs/`.
* For each file, compute and draw its inset border, adding it to the original file.

## Notes

* The generated border path is polyline-only. It contains no curves and uses only `M`, `L`, and `Z` commands.
* This is intentional, as it allows the `plateit-generator` library to slice and manipulate path segments directly, without additional processing or external dependencies.

