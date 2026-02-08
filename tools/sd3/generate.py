#!/usr/bin/env python3
"""
Stable Diffusion 3 Image Generation Tool
Usage: python generate.py --prompt "..." --output "path/to/output.png" --model "path/to/model.safetensors"
"""

import argparse
import json
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description='Generate images using Stable Diffusion 3')
    parser.add_argument('--prompt', required=True, help='Text prompt for image generation')
    parser.add_argument('--output', required=True, help='Output path for the generated image')
    parser.add_argument('--model', required=True, help='Path to the SD3 model checkpoint')
    parser.add_argument('--width', type=int, default=1024, help='Image width')
    parser.add_argument('--height', type=int, default=1024, help='Image height')
    parser.add_argument('--steps', type=int, default=20, help='Number of inference steps')
    parser.add_argument('--negative', default='', help='Negative prompt')
    parser.add_argument('--guidance', type=float, default=7.0, help='Guidance scale')

    args = parser.parse_args()

    print(f"Loading model from: {args.model}", file=sys.stderr)

    try:
        import torch
        from diffusers import StableDiffusion3Pipeline

        # Load pipeline
        pipe = StableDiffusion3Pipeline.from_single_file(
            args.model,
            torch_dtype=torch.float32  # CPU mode
        )

        print(f"Generating image: {args.prompt[:50]}...", file=sys.stderr)

        # Generate image
        image = pipe(
            prompt=args.prompt,
            negative_prompt=args.negative if args.negative else None,
            num_inference_steps=args.steps,
            guidance_scale=args.guidance,
            width=args.width,
            height=args.height,
        ).images[0]

        # Ensure output directory exists
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save image
        image.save(str(output_path))
        print(f"Image saved to: {output_path}", file=sys.stderr)

        # Output metadata as JSON
        metadata = {
            "success": True,
            "path": str(output_path),
            "width": args.width,
            "height": args.height,
            "steps": args.steps
        }
        print(json.dumps(metadata))

    except ImportError as e:
        print(f"Missing dependency: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
