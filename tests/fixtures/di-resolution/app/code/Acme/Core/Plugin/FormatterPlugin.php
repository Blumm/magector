<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class FormatterPlugin
{
    public function afterFormat($subject, $result)
    {
        return $result;
    }
}
