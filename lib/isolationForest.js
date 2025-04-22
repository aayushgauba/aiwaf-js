// lib/isolationForest.js

class IsolationTree {
    constructor(depth = 0, maxDepth = 0) {
      this.depth = depth;
      this.maxDepth = maxDepth;
      this.left = null;
      this.right = null;
      this.splitAttr = null;
      this.splitValue = null;
      this.size = 0;
    }
  
    fit(data) {
      this.size = data.length;
      // stop criteria
      if (this.depth >= this.maxDepth || data.length <= 1) return;
      // choose random feature
      const numFeatures = data[0].length;
      this.splitAttr = Math.floor(Math.random() * numFeatures);
      // find min/max on that feature
      let vals = data.map(row => row[this.splitAttr]);
      const min = Math.min(...vals), max = Math.max(...vals);
      if (min === max) return; 
      // choose random split
      this.splitValue = min + Math.random() * (max - min);
      // partition data
      const leftData = [], rightData = [];
      for (let row of data) {
        (row[this.splitAttr] < this.splitValue ? leftData : rightData).push(row);
      }
      // build subtrees
      this.left  = new IsolationTree(this.depth+1, this.maxDepth);
      this.right = new IsolationTree(this.depth+1, this.maxDepth);
      this.left.fit(leftData);
      this.right.fit(rightData);
    }
  
    pathLength(point) {
      // if leaf or no split, path ends here
      if (!this.left || !this.right) {
        // use average c(size) for external nodes
        return this.depth + c(this.size);
      }
      // descend
      if (point[this.splitAttr] < this.splitValue) {
        return this.left.pathLength(point);
      } else {
        return this.right.pathLength(point);
      }
    }
  }
  
  // average path length of unsuccessful search in a BST
  function c(n) {
    if (n <= 1) return 1;
    return 2 * (Math.log(n - 1) + 0.5772156649) - (2*(n-1)/n);
  }
  
  class IsolationForest {
    constructor({ nTrees = 100, sampleSize = 256 } = {}) {
      this.nTrees = nTrees;
      this.sampleSize = sampleSize;
      this.trees = [];
    }
  
    fit(data) {
      const heightLimit = Math.ceil(Math.log2(this.sampleSize));
      for (let i = 0; i < this.nTrees; i++) {
        // random subsample
        const sample = [];
        for (let j = 0; j < this.sampleSize; j++) {
          sample.push(data[Math.floor(Math.random() * data.length)]);
        }
        const tree = new IsolationTree(0, heightLimit);
        tree.fit(sample);
        this.trees.push(tree);
      }
    }
  
    anomalyScore(point) {
      // average path length
      const pathLens = this.trees.map(t => t.pathLength(point));
      const avgPath = pathLens.reduce((a,b) => a+b, 0) / this.nTrees;
      // score: 2^(-E[h(x)]/c(sampleSize))
      const cn = c(this.sampleSize);
      return Math.pow(2, -avgPath / cn);
    }
  
    // simple threshold helper
    isAnomaly(point, thresh = 0.5) {
      return this.anomalyScore(point) > thresh;
    }
  }
  
  module.exports = { IsolationForest };
  