<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class Audited
{
    public function save(string $id): string
    {
        return $id;
    }
}
