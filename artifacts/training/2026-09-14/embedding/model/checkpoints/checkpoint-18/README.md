---
tags:
- sentence-transformers
- sentence-similarity
- feature-extraction
- dense
- generated_from_trainer
- dataset_size:90
- loss:MultipleNegativesRankingLoss
pipeline_tag: sentence-similarity
library_name: sentence-transformers
---

# SentenceTransformer

This is a [sentence-transformers](https://www.SBERT.net) model trained. It maps sentences & paragraphs to a 512-dimensional dense vector space and can be used for semantic textual similarity, semantic search, paraphrase mining, classification, clustering, and more.

## Model Details

### Model Description
- **Model Type:** Sentence Transformer
<!-- - **Base model:** [Unknown](https://huggingface.co/unknown) -->
- **Maximum Sequence Length:** 512 tokens
- **Output Dimensionality:** 512 dimensions
- **Similarity Function:** Cosine Similarity
- **Supported Modality:** Text
<!-- - **Training Dataset:** Unknown -->
<!-- - **Language:** Unknown -->
<!-- - **License:** Unknown -->

### Model Sources

- **Documentation:** [Sentence Transformers Documentation](https://sbert.net)
- **Repository:** [Sentence Transformers on GitHub](https://github.com/huggingface/sentence-transformers)
- **Hugging Face:** [Sentence Transformers on Hugging Face](https://huggingface.co/models?library=sentence-transformers)

### Full Model Architecture

```
SentenceTransformer(
  (0): Transformer({'transformer_task': 'feature-extraction', 'modality_config': {'text': {'method': 'forward', 'method_output_name': 'last_hidden_state'}}, 'module_output_name': 'token_embeddings', 'architecture': 'BertModel'})
  (1): Pooling({'embedding_dimension': 512, 'pooling_mode': 'cls', 'include_prompt': True})
  (2): Normalize({})
)
```

## Usage

### Direct Usage (Sentence Transformers)

First install the Sentence Transformers library:

```bash
pip install -U sentence-transformers
```
Then you can load this model and run inference.
```python
from sentence_transformers import SentenceTransformer

# Download from the 🤗 Hub
model = SentenceTransformer("sentence_transformers_model_id")
# Run inference
sentences = [
    'The weather is lovely today.',
    "It's so sunny outside!",
    'He drove to the stadium.',
]
embeddings = model.encode(sentences)
print(embeddings.shape)
# [3, 512]

# Get the similarity scores for the embeddings
similarities = model.similarity(embeddings, embeddings)
print(similarities)
# tensor([[1.0000, 0.5525, 0.5360],
#         [0.5525, 1.0000, 0.4262],
#         [0.5360, 0.4262, 1.0000]])
```
<!--
### Direct Usage (Transformers)

<details><summary>Click to see the direct usage in Transformers</summary>

</details>
-->

<!--
### Downstream Usage (Sentence Transformers)

You can finetune this model on your own dataset.

<details><summary>Click to expand</summary>

</details>
-->

<!--
### Out-of-Scope Use

*List how the model may foreseeably be misused and address what users ought not to do with the model.*
-->

<!--
## Bias, Risks and Limitations

*What are the known or foreseeable issues stemming from this model? You could also flag here known failure cases or weaknesses of the model.*
-->

<!--
### Recommendations

*What are recommendations with respect to the foreseeable issues? For example, filtering explicit content.*
-->

## Training Details

### Training Dataset

#### Unnamed Dataset

* Size: 90 training samples
* Columns: <code>anchor</code> and <code>positive</code>
* Approximate statistics based on the first 90 samples:
  |          | anchor                                                                            | positive                                                                             |
  |:---------|:----------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------|
  | type     | string                                                                            | string                                                                               |
  | modality | text                                                                              | text                                                                                 |
  | details  | <ul><li>min: 9 tokens</li><li>mean: 15.76 tokens</li><li>max: 31 tokens</li></ul> | <ul><li>min: 63 tokens</li><li>mean: 152.89 tokens</li><li>max: 512 tokens</li></ul> |
* Samples:
  | anchor                        | positive                                                                                                                                                                                                                                                                |
  |:------------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | <code>理智归零的关键信息是什么？</code>    | <code>类型：condition<br>名称：理智归零<br>字段：{"effects":[{"event":{"flag":"ending.broken","type":"flag_set","value":true},"summary":"条件成立：理智归零，本场以调查员崩溃收场。"}],"id":"cond.san_broken","once":true,"title":"理智归零","when":{"resource":{"lte":0,"which":"san"}}}</code>              |
  | <code>码头的交易在凌晨三点意味着什么？</code> | <code>类型：fact<br>名称：码头的交易在凌晨三点<br>字段：{"id":"fact.dock_time","title":"码头的交易在凌晨三点","visibility":"secret"}</code>                                                                                                                                                          |
  | <code>书桌锁有什么作用？</code>        | <code>类型：item<br>名称：书桌锁<br>字段：{"aliases":["锁","挂锁","黄铜锁","书桌","写字台"],"at":"loc.study","id":"item.desk_lock","keeperNote":"女房东每天擦一次锁，划痕是她自己留下的。","observeGrants":"fact.lock_scratched","observed":"一把黄铜挂锁，锁体发黑，锁孔边缘有新划痕——最近有人动过。","portable":false,"title":"书桌锁"}</code> |
* Loss: [<code>MultipleNegativesRankingLoss</code>](https://sbert.net/docs/package_reference/sentence_transformer/losses.html#multiplenegativesrankingloss) with these parameters:
  ```json
  {
      "scale": 20.0,
      "similarity_fct": "cos_sim",
      "gather_across_devices": false,
      "directions": [
          "query_to_doc"
      ],
      "partition_mode": "joint",
      "hardness_mode": null,
      "hardness_strength": 0.0
  }
  ```

### Evaluation Dataset

#### Unnamed Dataset

* Size: 6 evaluation samples
* Columns: <code>anchor</code> and <code>positive</code>
* Approximate statistics based on the first 6 samples:
  |          | anchor                                                                             | positive                                                                            |
  |:---------|:-----------------------------------------------------------------------------------|:------------------------------------------------------------------------------------|
  | type     | string                                                                             | string                                                                              |
  | modality | text                                                                               | text                                                                                |
  | details  | <ul><li>min: 11 tokens</li><li>mean: 15.33 tokens</li><li>max: 20 tokens</li></ul> | <ul><li>min: 84 tokens</li><li>mean: 228.5 tokens</li><li>max: 512 tokens</li></ul> |
* Samples:
  | anchor                          | positive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  |:--------------------------------|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | <code>抵达旧终点的关键信息是什么？</code>     | <code>类型：condition<br>名称：抵达旧终点<br>字段：{"effects":[{"event":{"npc":"npc.shen","to":"loc.terminus","type":"npc_moved"},"summary":"旧雾港终点在前方出现。"}],"id":"cond.terminus","once":true,"title":"抵达旧终点","when":{"all":[{"known":"fact.old_line"},{"pcAt":"loc.cab"}]}}</code>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | <code>无名女孩真正的名字是许遥意味着什么？</code> | <code>类型：fact<br>名称：无名女孩真正的名字是许遥<br>字段：{"guardPhrases":["许遥"],"id":"fact.child_name","title":"无名女孩真正的名字是许遥","visibility":"secret"}</code>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | <code>核对沈鹭的档案通信的关键信息是什么？</code> | <code>类型：investigation<br>名称：核对沈鹭的档案通信<br>字段：{"alternateSkills":["侦查"],"defaultSkill":"图书馆使用","description":"用熟悉的誊抄格式核对档案箱里被改写的段落。","difficulty":"regular","id":"investigation.archive-correspondent","lifeHistoryId":"history.archive-correspondent","minutes":{"failure":15,"success":10},"outcomes":{"failure":[{"event":{"flag":"investigation.archive-correspondent.failed","type":"flag_set","value":true},"narration":"水渍把关键校记洇成一片，你只能确认有人故意改动过沈鹭的原稿。","summary":"潮湿档案暂时无法核清。"}],"success":[{"event":{"fact":"fact.memory_fuel","type":"fact_known"},"narration":"你认出沈鹭惯用的校记符号，顺着被抹去的旁注还原出一句话：列车烧掉的不是煤，而是没人再记得的那部分人生。","summary":"从沈鹭的通信中确认列车以遗忘的记忆为燃料。","visibility":"secret"}]},"phrases":["核对档案","检查沈鹭的通信","辨认誊抄格式"],"room":"loc.baggage-car","title":"核对沈鹭的档案通信","visibleWhen":{"not":{"known":"fact.memory_fuel"}}}</code> |
* Loss: [<code>MultipleNegativesRankingLoss</code>](https://sbert.net/docs/package_reference/sentence_transformer/losses.html#multiplenegativesrankingloss) with these parameters:
  ```json
  {
      "scale": 20.0,
      "similarity_fct": "cos_sim",
      "gather_across_devices": false,
      "directions": [
          "query_to_doc"
      ],
      "partition_mode": "joint",
      "hardness_mode": null,
      "hardness_strength": 0.0
  }
  ```

### Training Hyperparameters
#### Non-Default Hyperparameters

- `per_device_train_batch_size`: 16
- `learning_rate`: 2e-05
- `warmup_steps`: 0.1
- `fp16`: True
- `per_device_eval_batch_size`: 16
- `seed`: 8503
- `data_seed`: 8503
- `batch_sampler`: no_duplicates

#### All Hyperparameters
<details><summary>Click to expand</summary>

- `per_device_train_batch_size`: 16
- `num_train_epochs`: 3
- `max_steps`: -1
- `learning_rate`: 2e-05
- `lr_scheduler_type`: linear
- `lr_scheduler_kwargs`: None
- `warmup_steps`: 0.1
- `optim`: adamw_torch_fused
- `optim_args`: None
- `weight_decay`: 0.0
- `adam_beta1`: 0.9
- `adam_beta2`: 0.999
- `adam_epsilon`: 1e-08
- `optim_target_modules`: None
- `gradient_accumulation_steps`: 1
- `average_tokens_across_devices`: True
- `max_grad_norm`: 1.0
- `label_smoothing_factor`: 0.0
- `bf16`: False
- `fp16`: True
- `bf16_full_eval`: False
- `fp16_full_eval`: False
- `tf32`: None
- `gradient_checkpointing`: False
- `gradient_checkpointing_kwargs`: None
- `torch_compile`: False
- `torch_compile_backend`: None
- `torch_compile_mode`: None
- `use_liger_kernel`: False
- `liger_kernel_config`: None
- `use_cache`: False
- `neftune_noise_alpha`: None
- `torch_empty_cache_steps`: None
- `auto_find_batch_size`: False
- `log_on_each_node`: True
- `logging_nan_inf_filter`: True
- `include_num_input_tokens_seen`: no
- `log_level`: passive
- `log_level_replica`: warning
- `disable_tqdm`: False
- `project`: huggingface
- `trackio_space_id`: None
- `trackio_bucket_id`: None
- `trackio_static_space_id`: None
- `per_device_eval_batch_size`: 16
- `prediction_loss_only`: True
- `eval_on_start`: False
- `eval_do_concat_batches`: True
- `eval_use_gather_object`: False
- `eval_accumulation_steps`: None
- `include_for_metrics`: []
- `batch_eval_metrics`: False
- `save_only_model`: False
- `save_on_each_node`: False
- `enable_jit_checkpoint`: False
- `push_to_hub`: False
- `hub_private_repo`: None
- `hub_model_id`: None
- `hub_strategy`: every_save
- `hub_always_push`: False
- `hub_revision`: None
- `load_best_model_at_end`: False
- `ignore_data_skip`: False
- `restore_callback_states_from_checkpoint`: False
- `full_determinism`: False
- `seed`: 8503
- `data_seed`: 8503
- `use_cpu`: False
- `accelerator_config`: {'split_batches': False, 'dispatch_batches': None, 'even_batches': True, 'use_seedable_sampler': True, 'non_blocking': False, 'gradient_accumulation_kwargs': None}
- `parallelism_config`: None
- `dataloader_drop_last`: False
- `dataloader_num_workers`: 0
- `dataloader_pin_memory`: True
- `dataloader_persistent_workers`: False
- `dataloader_prefetch_factor`: None
- `dataloader_multiprocessing_context`: None
- `dataloader_in_order`: True
- `remove_unused_columns`: True
- `label_names`: None
- `train_sampling_strategy`: random
- `length_column_name`: length
- `ddp_find_unused_parameters`: None
- `ddp_bucket_cap_mb`: None
- `ddp_broadcast_buffers`: False
- `ddp_static_graph`: None
- `ddp_backend`: None
- `ddp_timeout`: 1800
- `fsdp`: None
- `fsdp_config`: None
- `deepspeed`: None
- `debug`: []
- `skip_memory_metrics`: True
- `do_predict`: False
- `resume_from_checkpoint`: None
- `local_rank`: -1
- `prompts`: None
- `batch_sampler`: no_duplicates
- `multi_dataset_batch_sampler`: proportional
- `router_mapping`: {}
- `learning_rate_mapping`: {}
- `warmup_ratio`: None

</details>

### Training Logs
| Epoch  | Step | Training Loss | Validation Loss |
|:------:|:----:|:-------------:|:---------------:|
| 1.0    | 6    | -             | 0.0791          |
| 1.6667 | 10   | 0.0756        | -               |
| 2.0    | 12   | -             | 0.0551          |
| 3.0    | 18   | -             | 0.0518          |


### Training Time
- **Training**: 2.3 minutes
- **Evaluation**: 0.1 seconds
- **Total**: 2.3 minutes

### Framework Versions
- Python: 3.12.3
- Sentence Transformers: 5.7.0
- Transformers: 5.17.0
- PyTorch: 2.8.0+cu128
- Accelerate: 1.15.0
- Datasets: 4.8.5
- Tokenizers: 0.23.2

## Additional Resources

- [Training and Finetuning Embedding Models with Sentence Transformers](https://huggingface.co/blog/train-sentence-transformers): the end-to-end guide for training or finetuning Sentence Transformer models.
- [Introduction to Matryoshka Embedding Models](https://huggingface.co/blog/matryoshka): variable-size embeddings that can be truncated with minimal quality loss.
- [Binary and Scalar Embedding Quantization for Significantly Faster & Cheaper Retrieval](https://huggingface.co/blog/embedding-quantization): post-training compression of embedding vectors.
- [Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/multimodal-sentence-transformers): use text, image, audio, and video models through the same API.
- [Training and Finetuning Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/train-multimodal-sentence-transformers): train multimodal embedding models, with a Visual Document Retrieval walkthrough.

## Citation

### BibTeX

#### Sentence Transformers
```bibtex
@inproceedings{reimers-2019-sentence-bert,
    title = "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
    author = "Reimers, Nils and Gurevych, Iryna",
    booktitle = "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing",
    month = "11",
    year = "2019",
    publisher = "Association for Computational Linguistics",
    url = "https://arxiv.org/abs/1908.10084",
}
```

#### MultipleNegativesRankingLoss
```bibtex
@misc{oord2019representationlearningcontrastivepredictive,
      title={Representation Learning with Contrastive Predictive Coding},
      author={Aaron van den Oord and Yazhe Li and Oriol Vinyals},
      year={2019},
      eprint={1807.03748},
      archivePrefix={arXiv},
      primaryClass={cs.LG},
      url={https://arxiv.org/abs/1807.03748},
}
```

<!--
## Glossary

*Clearly define terms in order to be accessible across audiences.*
-->

<!--
## Model Card Authors

*Lists the people who create the model card, providing recognition and accountability for the detailed work that goes into its construction.*
-->

<!--
## Model Card Contact

*Provides a way for people who have updates to the Model Card, suggestions, or questions, to contact the Model Card authors.*
-->