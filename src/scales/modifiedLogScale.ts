///<reference path="../reference.ts" />

module Plottable {
export module Scale {
  export class ModifiedLog extends Abstract.QuantitiveScale {
    private base: number;
    private pivot: number;
    private untransformedDomain: number[];

    /**
     * Creates a new Scale.ModifiedLog.
     *
     * A ModifiedLog scale acts as a regular log scale for large numbers.
     * As it approaches 0, it gradually becomes linear. This means that the
     * scale won't freak out if you give it 0 or a negative number, where an
     * ordinary Log scale would.
     *
     * However, it does mean that scale will be effectively linear as values
     * approach 0. If you want very small values on a log scale, you should use
     * an ordinary Scale.Log instead.
     *
     * @constructor
     * @param {number} [base]
     *        The base of the log. Defaults to 10, and must be > 1.
     *
     *        For base <= x, scale(x) = log(x).
     *
     *        For 0 < x < base, scale(x) will become more and more
     *        linear as it approaches 0.
     *
     *        At x == 0, scale(x) == 0.
     *
     *        For negative values, scale(-x) = -scale(x).
     */
    constructor(base = 10) {
      super(d3.scale.linear());
      this.base = base;
      this.pivot = this.base;
      this.untransformedDomain = this._defaultExtent();
      this._lastRequestedTickCount = 10;
      if (base <= 1) {
        throw new Error("ModifiedLogScale: The base must be > 1");
      }
    }

    /**
     * Returns an adjusted log10 value for graphing purposes.  The first
     * adjustment is that negative values are changed to positive during
     * the calculations, and then the answer is negated at the end.  The
     * second is that, for values less than 10, an increasingly large
     * (0 to 1) scaling factor is added such that at 0 the value is
     * adjusted to 1, resulting in a returned result of 0.
     */
    private adjustedLog(x: number): number {
      var negationFactor = x < 0 ? -1 : 1;
      x *= negationFactor;

      if (x < this.pivot) {
        x += (this.pivot - x) / this.pivot;
      }

      x = Math.log(x) / Math.log(this.base);

      x *= negationFactor;
      return x;
    }

    private invertedAdjustedLog(x: number): number {
      var negationFactor = x < 0 ? -1 : 1;
      x *= negationFactor;

      x = Math.pow(this.base, x);

      if (x < this.pivot) {
        x = (this.pivot * (x - 1)) / (this.pivot - 1);
      }

      x *= negationFactor;
      return x;
    }

    public scale(x: number): number {
      return this._d3Scale(this.adjustedLog(x));
    }

    public invert(x: number): number {
      return this.invertedAdjustedLog(this._d3Scale.invert(x));
    }

    public _getDomain() {
      return this.untransformedDomain;
    }

    public _setDomain(values: number[]) {
      this.untransformedDomain = values;
      var transformedDomain = [this.adjustedLog(values[0]), this.adjustedLog(values[1])];
      this._d3Scale.domain(transformedDomain);
      this.broadcaster.broadcast();
      return this;
    }

    public ticks(count?: number) {
      if (count != null) {
        super.ticks(count);
      }

      // Say your domain is [-100, 100] and your pivot is 10.
      // then we're going to draw negative log ticks from -100 to -10,
      // linear ticks from -10 to 10, and positive log ticks from 10 to 100.
      var middle = (x: number, y: number, z: number) => [x, y, z].sort((a, b) => a - b)[1];
      var min = d3.min(this.untransformedDomain);
      var max = d3.max(this.untransformedDomain);
      var negativeLower = min;
      var negativeUpper = middle(min, max, -this.pivot);
      var positiveLower = middle(min, max, this.pivot);
      var positiveUpper = max;

      var negativeLogTicks = this.logTicks(-negativeUpper, -negativeLower).map((x) => -x).reverse();
      var positiveLogTicks = this.logTicks(positiveLower, positiveUpper);
      var linearTicks = d3.scale.linear().domain([negativeUpper, positiveLower])
                                         .ticks(this.howManyTicks(negativeUpper, positiveLower));

      return negativeLogTicks.concat(linearTicks).concat(positiveLogTicks);
    }

    /**
     * Return an appropriate number of ticks from lower to upper.
     *
     * This will first try to fit as many powers of this.base as it can from
     * lower to upper.
     *
     * If it still has ticks after that, it will generate ticks in "clusters",
     * e.g. [20, 30, ... 90, 100] would be a cluster, [200, 300, ... 900, 1000]
     * would be another cluster.
     *
     * This function will generate clusters as large as it can while not
     * drastically exceeding its number of ticks.
     */
    private logTicks(lower: number, upper: number): number[] {
      var nTicks = this.howManyTicks(lower, upper);
      if (nTicks === 0) {
        return [];
      }
      var startLogged = Math.floor(Math.log(lower) / Math.log(this.base));
      var endLogged = Math.ceil(Math.log(upper) / Math.log(this.base));
      var bases = d3.range(endLogged, startLogged, -Math.ceil((endLogged - startLogged) / nTicks));
      var nMultiples = Math.floor(nTicks / bases.length);
      var multiples = d3.range(this.base, 1, -(this.base - 1) / nMultiples).map(Math.floor);
      var uniqMultiples = Util.Methods.uniqNumbers(multiples);
      var clusters = bases.map((b) => uniqMultiples.map((x) => Math.pow(this.base, b - 1) * x));
      var flattened = Util.Methods.flatten(clusters);
      var filtered = flattened.filter((x) => lower <= x && x <= upper);
      var sorted = filtered.sort((x, y) => x - y);
      return sorted;
    }

    /**
     * How many ticks does the range [lower, upper] deserve?
     *
     * e.g. if your domain was [10, 1000] and I asked howManyTicks(10, 100),
     * I would get 1/2 of the ticks. The range 10, 100 takes up 1/2 of the
     * distance when plotted.
     */
    private howManyTicks(lower: number, upper: number): number {
      var adjustedMin = this.adjustedLog(d3.min(this.untransformedDomain));
      var adjustedMax = this.adjustedLog(d3.max(this.untransformedDomain));
      var adjustedLower = this.adjustedLog(lower);
      var adjustedUpper = this.adjustedLog(upper);
      var proportion = (adjustedUpper - adjustedLower) / (adjustedMax - adjustedMin);
      var ticks = Math.ceil(proportion * this._lastRequestedTickCount);
      return ticks;
    }

    public copy(): ModifiedLog {
      return new ModifiedLog(this.base);
    }

    public _niceDomain(domain: any[], count?: number): any[] {
      return domain;
    }

  }
}
}
