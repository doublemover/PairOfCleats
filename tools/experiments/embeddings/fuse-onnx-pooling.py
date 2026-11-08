"""Produce an unqualified, identity-bound ONNX pooling prototype; never activate it.

Requires an explicitly prepared Python ONNX package. No install/download occurs.
Only small embedded FP32 graphs, default-domain opset13..17, are supported here.
Native/model numerical, recall, resource and transfer qualification is separate.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path


def produce(source, destination, expected_sha256, normalize):
    import onnx
    from onnx import TensorProto, helper

    source = Path(source).resolve()
    destination = Path(destination).resolve()
    receipt_path = destination.with_suffix(destination.suffix + ".pooling-prototype.json")
    if source == destination or destination.exists() or receipt_path.exists():
        raise ValueError("Prototype outputs must be new, separate files")
    if source.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("Embedded graph exceeds the prototype's 256MiB source limit")
    payload = source.read_bytes()
    source_digest = hashlib.sha256(payload).hexdigest()
    if source_digest != expected_sha256.lower():
        raise ValueError("Selected source graph bytes disagree with --source-sha256")
    model = onnx.load_model_from_string(payload)
    versions = [item.version for item in model.opset_import if item.domain in ("", "ai.onnx")]
    if len(versions) != 1 or not 13 <= versions[0] <= 17:
        raise ValueError("Prototype requires one default-domain opset13..17")
    if any(item.data_location == TensorProto.EXTERNAL for item in model.graph.initializer):
        raise ValueError("External-data closure rewriting is not qualified by this prototype")
    preferred = ["sentence_embedding", "embeddings", "pooler_output", "last_hidden_state", "output_0"]
    names = {item.name for item in model.graph.output}
    selected_name = next((name for name in preferred if name in names), None)
    selected = next((item for item in model.graph.output if item.name == selected_name), None)
    if selected is None or selected.type.tensor_type.elem_type != TensorProto.FLOAT:
        raise ValueError("Selected preferred graph output must be FP32")
    dimensions = selected.type.tensor_type.shape.dim
    if len(dimensions) != 3:
        raise ValueError("Existing rank2 sentence outputs remain the baseline; do not fuse them")
    mask = next((item for item in model.graph.input if item.name == "attention_mask"), None)
    if mask is None or len(mask.type.tensor_type.shape.dim) != 2:
        raise ValueError("Prototype requires the existing rank2 attention_mask input")
    if "sentence_embedding" in names:
        raise ValueError("A sentence_embedding output already exists")
    occupied = {name for node in model.graph.node for name in [*node.input, *node.output]}
    occupied.update(item.name for item in model.graph.initializer)
    prefix = "poc_pool_v1_" + source_digest[:16] + "_"
    if any(name.startswith(prefix) for name in occupied):
        raise ValueError("Prototype node namespace already exists")

    def constant(name, tensor_type, values):
        variable = prefix + name
        shape = [] if not isinstance(values, list) else [len(values)]
        model.graph.initializer.append(helper.make_tensor(variable, tensor_type, shape, values if isinstance(values, list) else [values]))
        return variable

    def node(op, inputs, name, **attributes):
        output = prefix + name
        model.graph.node.append(helper.make_node(op, inputs, [output], name=output, **attributes))
        return output

    token_axis = constant("token_axis", TensorProto.INT64, [1])
    expand_axis = constant("expand_axis", TensorProto.INT64, [2])
    coordinate_axis = constant("coordinate_axis", TensorProto.INT64, [1])
    zero = constant("zero", TensorProto.FLOAT, 0.0)
    one = constant("one", TensorProto.FLOAT, 1.0)
    mask_bool = node("Cast", ["attention_mask"], "mask_bool", to=TensorProto.BOOL)
    mask_float = node("Cast", [mask_bool], "mask_float", to=TensorProto.FLOAT)
    expanded_mask = node("Unsqueeze", [mask_bool, expand_axis], "expanded_mask")
    # Where excludes masked NaN/Inf values just as the host loop skips them;
    # multiplication by zero would not preserve that behavior.
    masked_states = node("Where", [expanded_mask, selected_name, zero], "masked_states")
    totals = node("ReduceSum", [masked_states, token_axis], "totals", keepdims=0)
    counts = node("ReduceSum", [mask_float, token_axis], "counts", keepdims=1)
    divisor = node("Max", [counts, one], "divisor")
    result = node("Div", [totals, divisor], "mean")
    if normalize:
        squared = node("Mul", [result, result], "squared")
        norm_squared = node("ReduceSum", [squared, coordinate_axis], "norm_squared", keepdims=1)
        norm = node("Sqrt", [norm_squared], "norm")
        positive = node("Greater", [norm, zero], "positive_norm")
        denominator = node("Where", [positive, norm, one], "norm_divisor")
        result = node("Div", [result, denominator], "normalized")
    model.graph.node.append(helper.make_node("Identity", [result], ["sentence_embedding"], name=prefix + "output"))
    batch = dimensions[0].dim_value or dimensions[0].dim_param or "batch"
    hidden = dimensions[2].dim_value or dimensions[2].dim_param or "hidden"
    model.graph.output.append(helper.make_tensor_value_info("sentence_embedding", TensorProto.FLOAT, [batch, hidden]))
    onnx.checker.check_model(model)
    transformed = model.SerializeToString()
    receipt = {
        "schemaVersion": 1,
        "status": "unqualified-prototype",
        "sourceGraphSha256": source_digest,
        "graphSha256": hashlib.sha256(transformed).hexdigest(),
        "processingIdentity": {
            "version": "onnx-mask-mean-prototype-v1",
            "sourceOutput": selected_name,
            "output": "sentence_embedding",
            "mask": "nonzero-count; masked-values-excluded",
            "zeroMask": "zero-vector",
            "normalize": bool(normalize),
            "reduction": "runtime-reduce-sum-fp32; host-sequential-rounding-not-assumed",
        },
        "qualification": {"numerical": "not-run", "topK": "not-run", "cpu": "not-run", "accelerator": "not-run"},
        "activation": "none; separate selected graph/processing identity and accepted qualification required",
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        for filename, value in [(destination, transformed), (receipt_path, (json.dumps(receipt, indent=2) + "\n").encode())]:
            with filename.open("xb") as handle:
                created.append(filename)
                remaining = memoryview(value)
                while remaining:
                    written = handle.write(remaining)
                    if not written:
                        raise OSError("Prototype write made no forward progress")
                    remaining = remaining[written:]
                handle.flush()
                os.fsync(handle.fileno())
    except BaseException as failure:
        for filename in reversed(created):
            try:
                filename.unlink(missing_ok=True)
            except OSError as cleanup_error:
                failure.add_note(f"Prototype cleanup failed at {filename}: {cleanup_error}")
        raise
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--normalize", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(produce(arguments.source, arguments.output, arguments.source_sha256, arguments.normalize)))
