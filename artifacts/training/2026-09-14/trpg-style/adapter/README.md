---
library_name: peft
license: other
base_model: /root/autodl-tmp/modelscope-cache/models/Qwen--Qwen2.5-3B-Instruct/snapshots/master
tags:
- base_model:adapter:/root/autodl-tmp/modelscope-cache/models/Qwen--Qwen2.5-3B-Instruct/snapshots/master
- llama-factory
- lora
- transformers
pipeline_tag: text-generation
model-index:
- name: qwen2.5-3b-lora-trpg
  results: []
---

<!-- This model card has been generated automatically according to the information the Trainer had access to. You
should probably proofread and complete it, then remove this comment. -->

# qwen2.5-3b-lora-trpg

This model is a fine-tuned version of [/root/autodl-tmp/modelscope-cache/models/Qwen--Qwen2.5-3B-Instruct/snapshots/master](https://huggingface.co//root/autodl-tmp/modelscope-cache/models/Qwen--Qwen2.5-3B-Instruct/snapshots/master) on the trpg_dm_train dataset.
It achieves the following results on the evaluation set:
- Loss: 3.2369

## Model description

More information needed

## Intended uses & limitations

More information needed

## Training and evaluation data

More information needed

## Training procedure

### Training hyperparameters

The following hyperparameters were used during training:
- learning_rate: 0.0001
- train_batch_size: 2
- eval_batch_size: 2
- seed: 42
- gradient_accumulation_steps: 8
- total_train_batch_size: 16
- optimizer: Use OptimizerNames.ADAMW_TORCH_FUSED with betas=(0.9,0.999) and epsilon=1e-08 and optimizer_args=No additional optimizer arguments
- lr_scheduler_type: cosine
- lr_scheduler_warmup_steps: 0.05
- num_epochs: 3.0
- mixed_precision_training: Native AMP

### Training results

| Training Loss | Epoch | Step | Validation Loss |
|:-------------:|:-----:|:----:|:---------------:|
| 2.0616        | 3.0   | 69   | 3.2369          |


### Framework versions

- PEFT 0.18.1
- Transformers 5.8.0
- Pytorch 2.8.0+cu128
- Datasets 4.0.0
- Tokenizers 0.22.2