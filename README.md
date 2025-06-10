# PairOfCleats 

*Give your Coding Agents a pair of cleats, so they can sprint through your codebase.*

## 🚀 What is PairOfCleats?

**PairOfCleats** _(pronounced 'Paraclete')_ is a utility that builds a hybrid semantic index of your Git repo. 

You run the build script "offline" on your local computer, which only takes a few minutes, then include the index in your agent image or repo.

Coding Agents then use the search utility, which allows them to query the index to get informative json blobs about code & docs. 

---

### 👟 Why PairOfCleats?

While using 3o, codex, and local models such as Devstral, I became frustrated with how many turns they seem to waste looking around with `git diff`, `find`, `grep`, `regex`, `nc` etc, commonly combining them with `tail` or `less` to 'brute force' their way through hundreds of lines of code in progressively smaller chunks while they fill their context window with garbage.

I figured it would be helpful if they were able to query the codebase and documentation as if they had the advanced searching features of a decent IDE and powerful text editor. Search can be filtered by function, class declaration, method signature, parameter, by function calls, module imports, lint issues, and more. 

<h3 align=center>👀 What does it look like?</h3>

<p align=center>
	<img src="https://i.imgur.com/CvoPk56.png" width="476" height="217">
	<br/>
	<i>This is the stylized, human readable output</i>
</p>

---

## ❓ Should I use it right now
- Probably not, I need to finish everything on the [roadmap](https://github.com/doublemover/PairOfCleats/blob/main/ROADMAP.md)

## 🔧 Requirements
- A decently fast computer to build the search index with, or patience
  - Takes a 5800X3D ~3m10s to build the index for this [JS Lemmings Port](https://github.com/doublemover/LemmingsJS-MIDI) (~430 files) when using `MiniLM-L12-v2` for chunk embeddings
	  - Index Size is ~15MB, can be tuned
  - Memory usage is currently low
  - Vague minspec target is a stock M2 Mini
  

<details>
<summary><h2>⚙️ Index Features</h2></summary>

- Recursively scans your codebase
  - **Code**: `.js`, `.yml`, `.sh`, `.html`, `.css`
  - **Prose**: `.md`, `.txt`
  - Skips irrelevant directories (`.git`, `node_modules`, `dist`, `coverage`, etc)
- Automatically determines ideal chunk size & dimension count separately for prose & code
- Configurable to prioritize offline generation time, index size, search speed, and accuracy
- Combines BM25 Search, embeddings, MinHash signatures, and rich code/documentation relations
- Smart Chunking
  - **Code**: Functions, Classes & Methods, Arrow Functions, Exports
  - **Prose**: Headings (Markdown/RST), Sections (YAML)
- Feature Extraction (per chunk)
	- **Tokenization & Stemming**  
	- **N-grams & Char n-grams** → for phrase search  
	- **BM25 stats** → sparse postings (compressed varint)  
	- **Dense vector embedding** (MiniLM) → for ANN search  
	- **MinHash signatures** → fast approximate similarity  
	- **Code relations**: Calls graph, Imports & Exports, Identifier usages
	- **Git metadata**: Last author & modified date, Churn score, Per-chunk blame authors
	- **Complexity analysis** (cyclomatic complexity of JS functions)
	- **Lint results** (via ESLint)
	- **Docstrings / Signatures / Param annotations** (via doc comment extraction)
	- **Headline generation** → auto-summarized chunk label
	- **Neighbor context** → pre/post lines for agent context windowing
</details>

<details>
<summary><h2>🔍 Search Features</h2></summary>

`node .\search.js searchterm`

Provides a CLI utility for **agent-friendly semantic search** of your repo.

#### Search Pipeline:

**Tokenization of Query**
- Smart splitting of camelCase, snake_case, natural language.
- Optional splitting of long identifiers with dictionary.

**Main Search Techniques**
- **BM25 token / phrase match**
  - Headline boosting
  - N-gram matches
- **MinHash-based ANN search**
  - Cross-file approximate similarity
- Combined + deduplicated result set.

**Advanced Filtering**
- `--type FunctionDeclaration` or `--type ClassDeclaration`
- `--author NAME`
- `--calls FUNC_NAME` → call graph filtering
- `--import MODULE`
- `--lint` → chunks with lint issues
- `--churn N` → high-churn code
- `--signature STR`, `--param PARAM`

**Rich Output**
- **Human-friendly mode** (with color-coded terminal output):
  - Headline, Calls graph, Imports & Exports, Identifier usages (with frequency)
  - Last author + churn score
  - Lint issues, External doc links
  - Pre/post context, Body summary
- **JSON mode**:
  - Machine-friendly output for agent toolchains.

**Metrics Tracking**
- Per-file hit frequency + terms → `.repoMetrics/metrics.json`
- Search history → `.repoMetrics/searchHistory`
- Failed queries → `.repoMetrics/noResultQueries`
- These metrics can be consumed by the index builder to enhance results
- Github workflows included to automatically handle merging these files

</details>

<details>
<summary><h3>What Agents Gain</h3></summary>

- **Fast codebase navigation** → jump to functions/classes/types.
- **Semantic similarity** → find similar code by content and structure.
- **Cross-file graphing** → follow calls and imports across files.
- **Recency awareness** → bias toward recent / high-churn code.
- **Doc surfacing** → pull in relevant documentation and comments.
- **Speed** → agents commonly waste several 'turns' looking for what they need to work on, once instructed to utilize this, even one successful use per task massively speeds up how fast they complete their tasks
- **Clarity** → because you control which files are indexed, agents only find what you want them to, enhancing task accuracy and lowering confusion

</details>

<details open>
<summary><h4>🤔 How Do I Know They're Using It?</h4></summary>
	
- Logs of every query are added to a history file and committed with the rest of the agent's work
- Searches with no results are tracked separately so you know if the index needs to be updated or references need to be adjusted
- Detailed metrics of results are also included to help with manual or automated tuning of index generation
- The included github workflows, git hooks/configuration, and merge scripts automatically handle appending new entries 
</details>

<details>
<summary><h4>🤨 How Do I Know It's Helping?</h4></summary>
	
- That's for you to decide!
- I've only been using this for a few days, without taking the time to measure it:
	- Task completion speed is faster, both succesful tasks and 'failures' such as detecting that the task has already been completed
	- Failures happen less
- If you have experience with running automated benchmarks of coding agents please reach out
	- I'd like to quantify the impact and it would help me improve this
</details>

<details>
<summary><h4>🤢 Why did you write it all in js</h4></summary>
	
- Javascript seems pretty good now you should try it
- The searches typically take 80-120ms to complete, I have seen some queries run as long as 1-1500ms but have since changed the way that metadata is stored within chunks when the index is built and improved the way it is consumed in the search tool
- There is another branch where I am rewriting the search tool in rust
- I will eventually also rewrite the index generation to use rust
</details>

---

## 💻 Installation

- Clone the repo
- Configure which file types and folders to skip
- Build the index
- Include the index & search.js
	- If the service you are using supports preconfigured agent images or loading from cache during environment setup, use that
	- Otherwise just chuck it in your git repo 
- Update AGENTS.md to instruct agents to utilize search.js & leave repo metrics alone
- Set up workflows and merge drivers for search metrics
- Enjoy!

--- 

<h3 align=center>😻 How can I help</h3>
<p align=center>Detailed issues are good.<br />
Pull requests are better.<br />
Money is best<br /></p>
<p align=center><a href="https://ko-fi.com/E1E71G7Y0T"><img src="https://ko-fi.com/img/githubbutton_sm.svg"></a></p>

<p align=center><i>Give your agents better shoes. 🏃‍♂️👟</i></p>
