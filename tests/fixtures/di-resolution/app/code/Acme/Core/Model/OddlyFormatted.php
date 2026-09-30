<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Acme\Core\Api\{
    FormatterInterface as F,
    NotifierInterface
};
use function strtoupper;

/**
 * Valid PHP, unusual layout: group use with an alias, the declaration split over many lines,
 * comments between the parts, and a trait `use` inside the body that is not an import.
 * class NotThisOne extends Nothing {}
 */
#[\AllowDynamicProperties]
class
OddlyFormatted
    extends
        HtmlFormatter // parent on its own line
    implements
        /* first */ F,
        NotifierInterface
{
    use OddlyFormattedTrait;

    public function
        format(string $value): string
    {
        return strtoupper($value);
    }

    public function notify(): void
    {
    }
}
