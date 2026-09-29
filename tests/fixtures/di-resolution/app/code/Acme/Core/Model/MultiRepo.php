<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Acme\Core\Api\RepoInterface, Acme\Core\Api\FormatterInterface;

/** Two interfaces in one `use` statement and in `implements`; each interface has a plugin. */
class MultiRepo implements RepoInterface,FormatterInterface
{
    public function save(string $id): string
    {
        return $id;
    }

    public function format(string $value): string
    {
        return $value;
    }
}
